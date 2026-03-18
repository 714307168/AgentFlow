package com.claudecode.remote.domain

import android.content.Context
import com.claudecode.remote.data.local.AppDatabase
import com.claudecode.remote.data.local.SessionEntity
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.CreateSessionRequest
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.BindProjectRequest
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

class SessionRepository(
    private val api: RelayApi,
    private val tokenStore: TokenStore,
    private val context: Context
) {
    private val db = AppDatabase.getInstance(context)
    private val sessionDao = db.sessionDao()

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
                CrashLogger.logInfo("SessionRepository", "No token found, creating session")
                val response = api.createSession(CreateSessionRequest(deviceId = deviceId))
                tokenStore.saveToken(response.token)
                CrashLogger.logInfo("SessionRepository", "Session created, token saved")
            } else {
                CrashLogger.logInfo("SessionRepository", "Token already exists")
            }

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
            val response = api.syncDevice("Bearer $token")

            CrashLogger.logInfo("SessionRepository", "Received response: agentId=${response.agentId}, projects count=${response.projects.size}")

            // Convert server projects to sessions
            val sessions = response.projects.mapIndexed { index, project ->
                CrashLogger.logInfo("SessionRepository", "Project $index: id=${project.id}, name=${project.name}, path=${project.path}")

                Session(
                    id = project.id,
                    name = project.name.ifEmpty { "Project ${project.id.take(8)}" },
                    agentId = response.agentId,
                    projectId = project.id,
                    projectPath = project.path,
                    createdAt = System.currentTimeMillis(),
                    lastActiveAt = System.currentTimeMillis()
                )
            }

            CrashLogger.logInfo("SessionRepository", "Inserting ${sessions.size} sessions into database")
            sessionDao.insertSessions(sessions.map { it.toEntity() })

            CrashLogger.logInfo("SessionRepository", "syncFromServer completed successfully")
            Result.success(Unit)
        } catch (e: Exception) {
            CrashLogger.logError("SessionRepository", "syncFromServer failed", e)
            Result.failure(e)
        }
    }

    suspend fun addSession(
        agentId: String,
        projectId: String,
        projectPath: String,
        name: String
    ): Result<Session> {
        return try {
            val token = tokenStore.getToken() ?: return Result.failure(Exception("Not authenticated"))
            api.bindProject(
                auth = "Bearer $token",
                request = BindProjectRequest(
                    projectId = projectId,
                    agentId = agentId,
                    path = projectPath,
                    name = name
                )
            )
            val session = Session(
                id = UUID.randomUUID().toString(),
                name = name,
                agentId = agentId,
                projectId = projectId,
                projectPath = projectPath,
                createdAt = System.currentTimeMillis(),
                lastActiveAt = System.currentTimeMillis()
            )
            sessionDao.insertSession(session.toEntity())
            Result.success(session)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getSessions(): List<Session> {
        return sessionDao.getAllSessions().map { entities ->
            entities.map { it.toSession() }
        }.first()
    }

    suspend fun removeSession(id: String) {
        sessionDao.deleteSession(id)
    }

    private fun Session.toEntity() = SessionEntity(
        id = id,
        name = name,
        agentId = agentId,
        projectId = projectId,
        projectPath = projectPath,
        createdAt = createdAt,
        lastActiveAt = lastActiveAt
    )

    private fun SessionEntity.toSession() = Session(
        id = id,
        name = name,
        agentId = agentId,
        projectId = projectId,
        projectPath = projectPath,
        createdAt = createdAt,
        lastActiveAt = lastActiveAt
    )
}
