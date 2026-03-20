package com.claudecode.remote.domain

import android.content.Context
import com.claudecode.remote.data.local.AppDatabase
import com.claudecode.remote.data.local.SessionEntity
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.ProjectInfo
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID

class SessionRepository(
    private val relayApiProvider: () -> RelayApi,
    private val tokenStore: TokenStore,
    private val context: Context
) {
    private val db = AppDatabase.getInstance(context)
    private val sessionDao = db.sessionDao()
    private val messageDao = db.messageDao()

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
                sessionDao.updateAgentStatus(projectId, isOnline, envelope.ts)
            }
        }
    }

    private suspend fun replaceSessionsFromDesktop(agentId: String, projects: List<ProjectInfo>) {
        val now = System.currentTimeMillis()
        val existingByProjectId = sessionDao.getAllSessionsSnapshot().associateBy { it.projectId }
        val existingProjectIds = sessionDao.getAllProjectIds().toSet()
        val nextProjectIds = projects.map { it.id }.toSet()
        val removedProjectIds = existingProjectIds - nextProjectIds

        val sessions = projects.map { project ->
            val existing = existingByProjectId[project.id]
            Session(
                id = project.id,
                name = project.name.ifEmpty { "Project ${project.id.take(8)}" },
                agentId = agentId,
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
                createdAt = existing?.createdAt ?: now,
                lastActiveAt = now
            )
        }

        sessionDao.deleteAllSessions()
        if (sessions.isNotEmpty()) {
            sessionDao.insertSessions(sessions.map { it.toEntity() })
        }

        removedProjectIds.forEach { projectId ->
            messageDao.deleteMessagesByProject(projectId)
        }
    }

    private fun Session.toEntity() = SessionEntity(
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
