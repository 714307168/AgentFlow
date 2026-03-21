package com.claudecode.remote.domain

import android.content.Context
import androidx.room.withTransaction
import com.claudecode.remote.data.local.AppDatabase
import com.claudecode.remote.data.local.SessionEntity
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.ProjectInfo
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.ConcurrentHashMap
import java.util.UUID

class SessionRepository(
    private val relayApiProvider: () -> RelayApi,
    private val tokenStore: TokenStore,
    private val context: Context
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val db = AppDatabase.getInstance(context)
    private val sessionDao = db.sessionDao()
    private val messageDao = db.messageDao()
    private val pendingOfflineJobs = ConcurrentHashMap<String, Job>()

    companion object {
        private const val OFFLINE_STATUS_DEBOUNCE_MS = 8_000L
    }

    val sessions: Flow<List<Session>> = sessionDao.getAllSessions().map { entities ->
        entities.map { it.toSession() }
    }

    suspend fun initialize(): Result<Unit> {
        return try {
            CrashLogger.logInfo("SessionRepository", "Starting initialization")

            var deviceId = tokenStore.getDeviceId()
            if (deviceId == null) {
                deviceId = UUID.randomUUID().toString()
                tokenStore.saveDeviceId(deviceId)
                CrashLogger.logInfo("SessionRepository", "Generated new deviceId: $deviceId")
            } else {
                CrashLogger.logInfo("SessionRepository", "Using existing deviceId: $deviceId")
            }

            if (tokenStore.getToken() == null) {
                CrashLogger.logError("SessionRepository", "No token found, login required before initialization")
                return Result.failure(Exception("Please sign in from Settings before connecting."))
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

    suspend fun syncFromServer(): Result<Unit> {
        return try {
            CrashLogger.logInfo("SessionRepository", "Starting syncFromServer")

            val token = tokenStore.getToken()
            if (token == null) {
                CrashLogger.logError("SessionRepository", "syncFromServer: No token available")
                return Result.failure(Exception("Not authenticated"))
            }

            CrashLogger.logInfo("SessionRepository", "Calling API syncDevice")
            val response = relayApiProvider().syncDevice("Bearer $token")

            CrashLogger.logInfo("SessionRepository", "Received response: agentId=${response.agentId}, projects count=${response.projects.size}")

            response.projects.forEachIndexed { index, project ->
                CrashLogger.logInfo("SessionRepository", "Project $index: id=${project.id}, name=${project.name}, path=${project.path}")
            }

            replaceSessionsFromDesktop(response.agentId, response.projects)

            CrashLogger.logInfo("SessionRepository", "syncFromServer completed successfully")
            Result.success(Unit)
        } catch (e: Exception) {
            CrashLogger.logError("SessionRepository", "syncFromServer failed", e)
            Result.failure(e)
        }
    }

    suspend fun getSessions(): List<Session> {
        return sessionDao.getAllSessions().map { entities ->
            entities.map { it.toSession() }
        }.first()
    }

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
                        cliProvider = projectObj["cli_provider"]?.jsonPrimitive?.contentOrNull?.ifBlank { "claude" } ?: "claude",
                        cliModel = projectObj["cli_model"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrEmpty() },
                        online = projectObj["online"]?.jsonPrimitive?.booleanOrNull
                    )
                } ?: emptyList()

                replaceSessionsFromDesktop(agentId, projects)
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

    private suspend fun replaceSessionsFromDesktop(agentId: String, projects: List<ProjectInfo>) {
        val now = System.currentTimeMillis()
        val existingByProjectId = sessionDao.getAllSessionsSnapshot().associateBy { it.projectId }
        if (projects.isEmpty() && existingByProjectId.isNotEmpty()) {
            CrashLogger.logInfo(
                "SessionRepository",
                "Ignoring empty project sync because local cache already has sessions"
            )
            return
        }
        val nextProjectIds = projects.map { it.id }.toSet()
        val removedProjectIds = existingByProjectId.keys - nextProjectIds

        db.withTransaction {
            projects.forEach { project ->
                val existing = existingByProjectId[project.id]
                if (project.online == true) {
                    cancelPendingOffline(project.id)
                }
                sessionDao.insertSession(
                    SessionEntity(
                        id = project.id,
                        name = project.name.ifEmpty { "Project ${project.id.take(8)}" },
                        agentId = agentId.ifBlank { existing?.agentId.orEmpty() },
                        projectId = project.id,
                        projectPath = project.path,
                        cliProvider = project.cliProvider,
                        cliModel = project.cliModel,
                        isAgentOnline = project.online ?: existing?.isAgentOnline ?: true,
                        isRunning = existing?.isRunning ?: false,
                        queuedCount = existing?.queuedCount ?: 0,
                        currentPrompt = existing?.currentPrompt,
                        queuePreview = existing?.queuePreview,
                        currentStartedAt = existing?.currentStartedAt,
                        lastSyncSeq = existing?.lastSyncSeq ?: 0,
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
        cliProvider = cliProvider,
        cliModel = cliModel,
        isAgentOnline = isAgentOnline,
        isRunning = isRunning,
        queuedCount = queuedCount,
        currentPrompt = currentPrompt,
        queuePreview = queuePreview,
        currentStartedAt = currentStartedAt,
        createdAt = createdAt,
        lastActiveAt = lastActiveAt
    )
}
