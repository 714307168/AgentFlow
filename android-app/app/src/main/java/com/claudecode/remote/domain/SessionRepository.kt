package com.claudecode.remote.domain

import android.content.Context
import androidx.room.withTransaction
import com.claudecode.remote.data.local.AppDatabase
import com.claudecode.remote.data.local.SessionEntity
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.AuthSessionManager
import com.claudecode.remote.data.remote.EffectiveScopeResponse
import com.claudecode.remote.data.remote.ProjectInfo
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.data.remote.RELAY_FEATURE_DEVICE_SYNC_DELTA
import com.claudecode.remote.data.remote.RELAY_FEATURE_EFFECTIVE_SCOPE
import com.claudecode.remote.data.remote.RELAY_FEATURE_DEVICE_SYNC_META
import com.claudecode.remote.data.remote.SyncDeltaRequest
import com.claudecode.remote.data.remote.isLegacyRelayMissingFeature
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.ConcurrentHashMap
import java.util.UUID

class SessionRepository(
    private val relayApiProvider: () -> RelayApi,
    private val authSessionManager: AuthSessionManager,
    private val tokenStore: TokenStore,
    private val context: Context
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val db = AppDatabase.getInstance(context)
    private val sessionDao = db.sessionDao()
    private val messageDao = db.messageDao()
    private val pendingOfflineJobs = ConcurrentHashMap<String, Job>()
    private val syncMutex = Mutex()
    private var inFlightSync = CompletableDeferred<Result<Unit>>()
    private var hasInFlightSync = false
    private var lastSuccessfulSyncAt = 0L
    private var currentProjectAccessScope: ProjectAccessScope? =
        ProjectAccessScopeCodec.decode(tokenStore.getEffectiveScopeJson())?.let(ProjectAccessScope::fromResponse)

    companion object {
        private const val OFFLINE_STATUS_DEBOUNCE_MS = 8_000L
        private const val MIN_SYNC_INTERVAL_MS = 3_000L
    }

    private data class EffectiveScopeRefreshResult(
        val changed: Boolean
    )

    val sessions: Flow<List<Session>> = sessionDao.getInboxSessions().map { entities ->
        entities.map { it.toSessionModel() }
    }

    suspend fun initialize(): Result<Unit> {
        return try {
            CrashLogger.logInfo("SessionRepository", "Starting initialization")
            purgeLegacyWorkgroupMessages()

            var deviceId = tokenStore.getDeviceId()
            if (deviceId == null) {
                deviceId = UUID.randomUUID().toString()
                tokenStore.saveDeviceId(deviceId)
                CrashLogger.logInfo("SessionRepository", "Generated new deviceId: $deviceId")
            } else {
                CrashLogger.logInfo("SessionRepository", "Using existing deviceId: $deviceId")
            }

            val deviceIdForInit = tokenStore.getDeviceId().orEmpty()
            val tokenResult = if (deviceIdForInit.isNotBlank()) {
                authSessionManager.ensureValidToken(deviceIdForInit)
            } else {
                Result.failure(IllegalStateException("Device ID is missing"))
            }

            if (tokenResult.isFailure) {
                CrashLogger.logInfo("SessionRepository", "No token found, skipping initialization until login")
                return Result.success(Unit)
            }
            CrashLogger.logInfo("SessionRepository", "Token already exists")

            // Auto-sync projects from server
            CrashLogger.logInfo("SessionRepository", "Starting project sync")
            syncFromServer()

            CrashLogger.logInfo("SessionRepository", "Initialization completed successfully")
            Result.success(Unit)
        } catch (e: Exception) {
            CrashLogger.logError("SessionRepository", "Initialization failed", e)
            Result.failure(e)
        }
    }

    suspend fun syncFromServer(force: Boolean = false): Result<Unit> {
        val deferred = syncMutex.withLock {
            if (hasInFlightSync) {
                return@withLock inFlightSync
            }
            val now = System.currentTimeMillis()
            if (!force && lastSuccessfulSyncAt > 0L && now - lastSuccessfulSyncAt < MIN_SYNC_INTERVAL_MS) {
                return@withLock null
            }
            inFlightSync = CompletableDeferred()
            hasInFlightSync = true
            inFlightSync
        }

        if (deferred == null) {
            return Result.success(Unit)
        }

        val result = try {
            CrashLogger.logInfo("SessionRepository", "Starting syncFromServer")
            purgeLegacyWorkgroupMessages()

            val deviceId = tokenStore.getDeviceId().orEmpty()
            val token = authSessionManager.ensureValidToken(deviceId).getOrElse { error ->
                CrashLogger.logError("SessionRepository", "syncFromServer: No token available", error)
                return Result.failure(error)
            }

            val scopeRefresh = refreshEffectiveScope(token)
            val cachedSessions = pruneProjectsOutsideScope(sessionDao.getAllSessionsSnapshot())
            var previousRevision = tokenStore.getDeviceSyncRevision()?.trim().orEmpty().ifEmpty { null }
            if (scopeRefresh.changed && previousRevision != null) {
                tokenStore.saveDeviceSyncRevision("")
                previousRevision = null
                CrashLogger.logInfo(
                    "SessionRepository",
                    "Effective scope changed; cleared cached device sync revision before sync"
                )
            }
            var shouldSkipFullSync = false
            if (!force && cachedSessions.isNotEmpty()) {
                val meta = resolveSyncMetaOrNull(token, previousRevision)
                if (meta != null) {
                    if (!meta.changed && previousRevision != null && meta.revision == previousRevision) {
                        if (!tryApplyProjectSyncDelta(
                                token = token,
                                previousRevision = previousRevision,
                                cachedSessions = cachedSessions,
                                reason = "unchanged-revision"
                            )
                        ) {
                            tokenStore.saveDeviceSyncRevision(meta.revision)
                            CrashLogger.logInfo(
                                "SessionRepository",
                                "Skipping full project sync because revision is unchanged and delta is unavailable revision=${meta.revision} projectCount=${meta.projectCount}"
                            )
                        }
                        shouldSkipFullSync = true
                    } else if (previousRevision != null) {
                        val deltaApplied = tryApplyProjectSyncDelta(
                            token = token,
                            previousRevision = previousRevision,
                            cachedSessions = cachedSessions,
                            reason = "revision-changed"
                        )
                        if (deltaApplied) {
                            shouldSkipFullSync = true
                        } else {
                            CrashLogger.logInfo(
                                "SessionRepository",
                                "Project sync revision changed previous=${previousRevision} next=${meta.revision} projectCount=${meta.projectCount}; delta unavailable so falling back to full sync"
                            )
                        }
                    } else {
                        CrashLogger.logInfo(
                            "SessionRepository",
                            "Project sync revision changed previous=${previousRevision ?: "none"} next=${meta.revision} projectCount=${meta.projectCount}"
                        )
                    }
                }
            }

            if (shouldSkipFullSync) {
                Result.success(Unit)
            } else {
                CrashLogger.logInfo("SessionRepository", "Calling API syncDevice")
                val response = relayApiProvider().syncDevice("Bearer $token")

                CrashLogger.logInfo("SessionRepository", "Received response: agentId=${response.agentId}, projects count=${response.projects.size}")

                response.projects.forEachIndexed { index, project ->
                    CrashLogger.logInfo("SessionRepository", "Project $index: id=${project.id}, name=${project.name}, path=${project.path}")
                }

                val scopedProjects = currentProjectAccessScope?.filterProjects(response.agentId, response.projects)
                    ?: response.projects
                val trustEmptyFullReplace = shouldTrustEmptyFullProjectReplacement(
                    projectCount = response.projectCount,
                    revision = response.revision,
                    hasExplicitProjectAccessScope = currentProjectAccessScope?.hasExplicitScopes() == true
                )
                replaceSessionsFromDesktop(
                    agentId = response.agentId,
                    projects = scopedProjects,
                    fullReplace = true,
                    trustEmptyFullReplace = trustEmptyFullReplace
                )
                val resolvedRevision = response.revision?.trim().orEmpty()
                if (scopedProjects.isNotEmpty() || cachedSessions.isEmpty() || trustEmptyFullReplace) {
                    tokenStore.saveDeviceSyncRevision(resolvedRevision)
                }

                CrashLogger.logInfo("SessionRepository", "syncFromServer completed successfully")
                Result.success(Unit)
            }
        } catch (e: Exception) {
            CrashLogger.logError("SessionRepository", "syncFromServer failed", e)
            Result.failure(e)
        }

        syncMutex.withLock {
            if (result.isSuccess) {
                lastSuccessfulSyncAt = System.currentTimeMillis()
            }
            if (hasInFlightSync) {
                inFlightSync.complete(result)
                hasInFlightSync = false
            }
        }

        return deferred.await()
    }

    suspend fun getSessions(): List<Session> {
        return sessionDao.getAllSessions().map { entities ->
            entities.map { it.toSessionModel() }
        }.first()
    }

    suspend fun getInboxSessionSnapshots(): List<Session> =
        sessionDao.getInboxSessionsSnapshot().map { it.toSessionModel() }

    suspend fun getSessionSnapshot(projectId: String): Session? =
        sessionDao.getSessionByProjectId(projectId)?.toSessionModel()

    suspend fun processEnvelope(envelope: Envelope) {
        when (envelope.event) {
            Events.PROJECT_LISTED -> {
                val payloadObj = envelope.payload?.jsonObject ?: return
                val agentId = payloadObj["agent_id"]?.jsonPrimitive?.contentOrNull ?: ""
                val projects = payloadObj["projects"]?.jsonArray?.mapNotNull { item ->
                    val projectObj = item.jsonObject
                    val id = projectObj["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                    if (id.isEmpty()) {
                        return@mapNotNull null
                    }

                    ProjectInfo(
                        id = id,
                        name = projectObj["name"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                        path = projectObj["path"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                        groupName = projectObj["group_name"]?.jsonPrimitive?.contentOrNull?.trim(),
                        cliProvider = projectObj["cli_provider"]?.jsonPrimitive?.contentOrNull?.ifBlank { "claude" } ?: "claude",
                        cliModel = projectObj["cli_model"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
                        online = projectObj["online"]?.jsonPrimitive?.booleanOrNull
                    )
                } ?: emptyList()

                val scopedProjects = currentProjectAccessScope?.filterProjects(agentId, projects) ?: projects
                replaceSessionsFromDesktop(agentId, scopedProjects, fullReplace = false)
            }
            Events.AGENT_STATUS -> {
                val payloadObj = envelope.payload?.jsonObject ?: return
                val projectId = payloadObj["project_id"]?.jsonPrimitive?.contentOrNull ?: envelope.projectId ?: return
                val isOnline = payloadObj["online"]?.jsonPrimitive?.booleanOrNull ?: return
                if (isOnline) {
                    cancelPendingOffline(projectId)
                    sessionDao.updateAgentStatus(projectId, true, envelope.ts)
                } else {
                    scheduleOfflineStatus(projectId, envelope.ts)
                }
            }
        }
    }

    private suspend fun replaceSessionsFromDesktop(
        agentId: String,
        projects: List<ProjectInfo>,
        fullReplace: Boolean,
        trustEmptyFullReplace: Boolean = false
    ) {
        val now = System.currentTimeMillis()
        val existingByProjectId = sessionDao.getAllSessionsSnapshot().associateBy { it.projectId }
        if (fullReplace && projects.isEmpty() && existingByProjectId.isNotEmpty() && !trustEmptyFullReplace) {
            CrashLogger.logInfo(
                "SessionRepository",
                "Ignoring empty project sync because local cache already has sessions"
            )
            return
        }
        val removedProjectIds = buildRemovedProjectIdsForReplacement(
            existingSessions = existingByProjectId.values,
            nextProjects = projects,
            agentId = agentId,
            fullReplace = fullReplace
        )

        db.withTransaction {
            projects.forEach { project ->
                val existing = existingByProjectId[project.id]
                if (project.online == true) {
                    cancelPendingOffline(project.id)
                }
                sessionDao.insertSession(mergeSessionEntityFromProject(existing, project, agentId, now))
            }

            removedProjectIds.forEach { projectId ->
                deleteProjectLocally(projectId)
            }
        }
    }

    private suspend fun applyProjectSyncDelta(
        agentId: String,
        projectUpserts: List<ProjectInfo>,
        projectRemoves: List<String>
    ) {
        val now = System.currentTimeMillis()
        val existingByProjectId = sessionDao.getAllSessionsSnapshot().associateBy { it.projectId }
        val allowedProjects = currentProjectAccessScope?.filterProjects(agentId, projectUpserts) ?: projectUpserts
        val normalizedUpserts = allowedProjects
            .mapNotNull { project ->
                val projectId = project.id.trim()
                if (projectId.isEmpty()) {
                    null
                } else {
                    project.copy(id = projectId)
                }
            }
            .associateBy { it.id }
        val normalizedRemoves = buildRemovedProjectIdsForDelta(
            projectRemoves = projectRemoves,
            retainedProjectIds = normalizedUpserts.keys
        )

        db.withTransaction {
            normalizedUpserts.values.forEach { project ->
                if (project.online == true) {
                    cancelPendingOffline(project.id)
                }
                sessionDao.insertSession(
                    mergeSessionEntityFromProject(
                        existing = existingByProjectId[project.id],
                        project = project,
                        fallbackAgentId = agentId,
                        now = now
                    )
                )
            }

            normalizedRemoves.forEach { projectId ->
                cancelPendingOffline(projectId)
                deleteProjectLocally(projectId)
            }
        }
    }

    private suspend fun tryApplyProjectSyncDelta(
        token: String,
        previousRevision: String,
        cachedSessions: List<SessionEntity>,
        reason: String
    ): Boolean {
        val delta = resolveSyncDeltaOrNull(
            token = token,
            previousRevision = previousRevision,
            cachedSessions = cachedSessions
        ) ?: return false

        if (!delta.changed && delta.projectUpserts.isEmpty() && delta.projectRemoves.isEmpty()) {
            tokenStore.saveDeviceSyncRevision(delta.revision)
            CrashLogger.logInfo(
                "SessionRepository",
                "Skipping full project sync because delta resolved no material changes reason=$reason revision=${delta.revision} projectCount=${delta.projectCount}"
            )
            return true
        }

        applyProjectSyncDelta(
            agentId = delta.agentId,
            projectUpserts = delta.projectUpserts,
            projectRemoves = delta.projectRemoves
        )
        tokenStore.saveDeviceSyncRevision(delta.revision)
        CrashLogger.logInfo(
            "SessionRepository",
            "Applied project delta sync reason=$reason revision=${delta.revision} upserts=${delta.projectUpserts.size} removes=${delta.projectRemoves.size} projectCount=${delta.projectCount}"
        )
        return true
    }

    private fun cancelPendingOffline(projectId: String) {
        pendingOfflineJobs.remove(projectId)?.cancel()
    }

    private suspend fun refreshEffectiveScope(token: String): EffectiveScopeRefreshResult =
        when (tokenStore.getRelayFeatureSupport(normalizeServerUrlForFeatureCache(), RELAY_FEATURE_EFFECTIVE_SCOPE)) {
            false -> {
                val hadStoredScope = !tokenStore.getEffectiveScopeJson().isNullOrBlank()
                currentProjectAccessScope = null
                tokenStore.saveEffectiveScopeJson(null)
                EffectiveScopeRefreshResult(changed = hadStoredScope)
            }
            else -> runCatching {
                relayApiProvider().getEffectiveScope("Bearer ${token}")
            }.onSuccess {
                tokenStore.saveRelayFeatureSupport(
                    normalizeServerUrlForFeatureCache(),
                    RELAY_FEATURE_EFFECTIVE_SCOPE,
                    true
                )
            }.map { response ->
                persistEffectiveScope(response)
            }.getOrElse { error ->
                if (error.isLegacyRelayMissingFeature()) {
                    tokenStore.saveRelayFeatureSupport(
                        normalizeServerUrlForFeatureCache(),
                        RELAY_FEATURE_EFFECTIVE_SCOPE,
                        false
                    )
                    val hadStoredScope = !tokenStore.getEffectiveScopeJson().isNullOrBlank()
                    currentProjectAccessScope = null
                    tokenStore.saveEffectiveScopeJson(null)
                    CrashLogger.logInfo(
                        "SessionRepository",
                        "Effective scope is unavailable on current relay version; falling back to legacy unscoped access"
                    )
                    EffectiveScopeRefreshResult(changed = hadStoredScope)
                } else {
                    throw error
                }
            }
        }

    private fun persistEffectiveScope(response: EffectiveScopeResponse): EffectiveScopeRefreshResult {
        val nextRawJson = ProjectAccessScopeCodec.encode(response)
        val previousRawJson = tokenStore.getEffectiveScopeJson()?.trim().orEmpty()
        tokenStore.saveEffectiveScopeJson(nextRawJson)
        currentProjectAccessScope = ProjectAccessScope.fromResponse(response)
        return EffectiveScopeRefreshResult(changed = previousRawJson != nextRawJson)
    }

    private suspend fun pruneProjectsOutsideScope(cachedSessions: List<SessionEntity>): List<SessionEntity> {
        val accessScope = currentProjectAccessScope ?: return cachedSessions
        val removedProjectIds = accessScope.findOutOfScopeProjectIds(cachedSessions)
        if (removedProjectIds.isEmpty()) {
            return cachedSessions
        }

        db.withTransaction {
            removedProjectIds.forEach { projectId ->
                cancelPendingOffline(projectId)
                deleteProjectLocally(projectId)
            }
        }
        CrashLogger.logInfo(
            "SessionRepository",
            "Pruned ${removedProjectIds.size} cached project(s) that are outside the current effective scope"
        )
        return cachedSessions.filterNot { session -> session.projectId.trim() in removedProjectIds }
    }

    private suspend fun purgeLegacyWorkgroupMessages() {
        val deletedCount = db.withTransaction {
            messageDao.deleteMessagesBySource("workgroup")
        }
        if (deletedCount > 0) {
            CrashLogger.logInfo(
                "SessionRepository",
                "Purged $deletedCount legacy workgroup messages from project message storage"
            )
        }
    }

    private suspend fun deleteProjectLocally(projectId: String) {
        sessionDao.deleteSessionByProjectId(projectId)
        messageDao.deleteMessagesByProject(projectId)
        tokenStore.clearDraft(projectId)
        tokenStore.clearProjectChatSnapshot(projectId)
    }

    private fun scheduleOfflineStatus(projectId: String, timestamp: Long) {
        pendingOfflineJobs.remove(projectId)?.cancel()
        pendingOfflineJobs[projectId] = scope.launch {
            delay(OFFLINE_STATUS_DEBOUNCE_MS)
            sessionDao.updateAgentStatus(projectId, false, timestamp)
            pendingOfflineJobs.remove(projectId)
            CrashLogger.logInfo(
                "SessionRepository",
                "Applied delayed offline status for projectId=$projectId after debounce"
            )
        }
    }

    private suspend fun resolveSyncMetaOrNull(token: String, previousRevision: String?) =
        when (tokenStore.getRelayFeatureSupport(normalizeServerUrlForFeatureCache(), RELAY_FEATURE_DEVICE_SYNC_META)) {
            false -> {
                CrashLogger.logInfo(
                    "SessionRepository",
                    "Skipping device sync meta probe because current relay is cached as unsupported"
                )
                null
            }
            else -> runCatching {
                relayApiProvider().syncDeviceMeta(
                    auth = "Bearer $token",
                    sinceRevision = previousRevision
                )
            }.onSuccess {
                tokenStore.saveRelayFeatureSupport(
                    normalizeServerUrlForFeatureCache(),
                    RELAY_FEATURE_DEVICE_SYNC_META,
                    true
                )
            }.getOrElse { error ->
                if (error.isLegacyRelayMissingFeature()) {
                    tokenStore.saveRelayFeatureSupport(
                        normalizeServerUrlForFeatureCache(),
                        RELAY_FEATURE_DEVICE_SYNC_META,
                        false
                    )
                    CrashLogger.logInfo(
                        "SessionRepository",
                        "Device sync meta is unavailable on current relay version; falling back to legacy full sync"
                    )
                    null
                } else {
                    throw error
                }
            }
        }

    private suspend fun resolveSyncDeltaOrNull(
        token: String,
        previousRevision: String,
        cachedSessions: List<SessionEntity>
    ) = when (
        tokenStore.getRelayFeatureSupport(
            normalizeServerUrlForFeatureCache(),
            RELAY_FEATURE_DEVICE_SYNC_DELTA
        )
    ) {
        false -> {
            CrashLogger.logInfo(
                "SessionRepository",
                "Skipping device sync delta probe because current relay is cached as unsupported"
            )
            null
        }
        else -> runCatching {
            relayApiProvider().syncDeviceDelta(
                auth = "Bearer $token",
                request = SyncDeltaRequest(
                    sinceRevision = previousRevision,
                    knownProjects = buildKnownProjectsForDelta(cachedSessions),
                    knownProjectIds = buildKnownProjectIdsForDelta(cachedSessions)
                )
            )
        }.onSuccess {
            tokenStore.saveRelayFeatureSupport(
                normalizeServerUrlForFeatureCache(),
                RELAY_FEATURE_DEVICE_SYNC_DELTA,
                true
            )
        }.getOrElse { error ->
            if (error.isLegacyRelayMissingFeature()) {
                tokenStore.saveRelayFeatureSupport(
                    normalizeServerUrlForFeatureCache(),
                    RELAY_FEATURE_DEVICE_SYNC_DELTA,
                    false
                )
                CrashLogger.logInfo(
                    "SessionRepository",
                    "Device sync delta is unavailable on current relay version; falling back to legacy full sync"
                )
                null
            } else {
                throw error
            }
        }
    }

    private fun normalizeServerUrlForFeatureCache(): String? {
        val value = tokenStore.getServerUrl()?.trim().orEmpty()
        return value.ifEmpty { null }
    }

}
