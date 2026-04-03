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
import com.claudecode.remote.data.remote.ProjectInfo
import com.claudecode.remote.data.remote.RelayApi
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

    companion object {
        private const val OFFLINE_STATUS_DEBOUNCE_MS = 8_000L
        private const val MIN_SYNC_INTERVAL_MS = 3_000L
    }

    val sessions: Flow<List<Session>> = sessionDao.getInboxSessions().map { entities ->
        entities.map { it.toSession() }
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

            CrashLogger.logInfo("SessionRepository", "Calling API syncDevice")
            val response = relayApiProvider().syncDevice("Bearer $token")

            CrashLogger.logInfo("SessionRepository", "Received response: agentId=${response.agentId}, projects count=${response.projects.size}")

            response.projects.forEachIndexed { index, project ->
                CrashLogger.logInfo("SessionRepository", "Project $index: id=${project.id}, name=${project.name}, path=${project.path}")
            }

            replaceSessionsFromDesktop(response.agentId, response.projects, fullReplace = true)

            CrashLogger.logInfo("SessionRepository", "syncFromServer completed successfully")
            Result.success(Unit)
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
            entities.map { it.toSession() }
        }.first()
    }

    suspend fun getInboxSessionSnapshots(): List<Session> =
        sessionDao.getInboxSessionsSnapshot().map { it.toSession() }

    suspend fun getSessionSnapshot(projectId: String): Session? =
        sessionDao.getSessionByProjectId(projectId)?.toSession()

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

                replaceSessionsFromDesktop(agentId, projects, fullReplace = false)
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

    private suspend fun replaceSessionsFromDesktop(agentId: String, projects: List<ProjectInfo>, fullReplace: Boolean) {
        val now = System.currentTimeMillis()
        val existingByProjectId = sessionDao.getAllSessionsSnapshot().associateBy { it.projectId }
        if (fullReplace && projects.isEmpty() && existingByProjectId.isNotEmpty()) {
            CrashLogger.logInfo(
                "SessionRepository",
                "Ignoring empty project sync because local cache already has sessions"
            )
            return
        }
        val nextProjectIds = projects.map { it.id }.toSet()
        val removedProjectIds = if (fullReplace) {
            existingByProjectId.keys - nextProjectIds
        } else {
            existingByProjectId.values
                .filter { it.agentId == agentId }
                .map { it.projectId }
                .filter { !nextProjectIds.contains(it) }
                .toSet()
        }

        db.withTransaction {
            projects.forEach { project ->
                val existing = existingByProjectId[project.id]
                val resolvedAgentId = project.agentId.ifBlank {
                    agentId.ifBlank { existing?.agentId.orEmpty() }
                }
                if (project.online == true) {
                    cancelPendingOffline(project.id)
                }
                sessionDao.insertSession(
                    SessionEntity(
                        id = project.id,
                        name = project.name.ifEmpty { "Project ${project.id.take(8)}" },
                        agentId = resolvedAgentId,
                        projectId = project.id,
                        projectPath = project.path,
                        groupName = project.groupName?.trim().takeUnless { it.isNullOrEmpty() } ?: existing?.groupName,
                        cliProvider = project.cliProvider,
                        cliModel = project.cliModel,
                        isAgentOnline = project.online ?: existing?.isAgentOnline ?: true,
                        isRunning = existing?.isRunning ?: false,
                        queuedCount = existing?.queuedCount ?: 0,
                        currentPrompt = existing?.currentPrompt,
                        queuePreview = existing?.queuePreview,
                        queueJson = existing?.queueJson,
                        currentStartedAt = existing?.currentStartedAt,
                        lastSyncSeq = existing?.lastSyncSeq ?: 0,
                        activeConversationId = existing?.activeConversationId,
                        activeConversationTitle = existing?.activeConversationTitle,
                        conversationsJson = existing?.conversationsJson,
                        createdAt = existing?.createdAt ?: now,
                        lastActiveAt = if (project.online != null) now else (existing?.lastActiveAt ?: now)
                    )
                )
            }

            removedProjectIds.forEach { projectId ->
                sessionDao.deleteSessionByProjectId(projectId)
                messageDao.deleteMessagesByProject(projectId)
            }
        }
    }

    private fun cancelPendingOffline(projectId: String) {
        pendingOfflineJobs.remove(projectId)?.cancel()
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

    private fun SessionEntity.toSession() = Session(
        id = id,
        name = name,
        agentId = agentId,
        projectId = projectId,
        projectPath = projectPath,
        groupName = groupName,
        cliProvider = cliProvider,
        cliModel = cliModel,
        isAgentOnline = isAgentOnline,
        isRunning = isRunning,
        queuedCount = queuedCount,
        currentPrompt = currentPrompt,
        queuePreview = queuePreview,
        queueJson = queueJson,
        currentStartedAt = currentStartedAt,
        activeConversationId = activeConversationId,
        activeConversationTitle = activeConversationTitle,
        conversationsJson = conversationsJson,
        createdAt = createdAt,
        lastActiveAt = lastActiveAt
    )
}
