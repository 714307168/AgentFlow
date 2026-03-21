package com.claudecode.remote.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface SessionDao {
    @Query("SELECT * FROM sessions ORDER BY createdAt ASC, name COLLATE NOCASE ASC, id ASC")
    fun getAllSessions(): Flow<List<SessionEntity>>

    @Query("SELECT * FROM sessions")
    suspend fun getAllSessionsSnapshot(): List<SessionEntity>

    @Query("SELECT * FROM sessions WHERE id = :id")
    suspend fun getSessionById(id: String): SessionEntity?

    @Query("SELECT * FROM sessions WHERE projectId = :projectId LIMIT 1")
    fun observeSessionByProjectId(projectId: String): Flow<SessionEntity?>

    @Query("SELECT * FROM sessions WHERE projectId = :projectId LIMIT 1")
    suspend fun getSessionByProjectId(projectId: String): SessionEntity?

    @Query("SELECT projectId FROM sessions")
    suspend fun getAllProjectIds(): List<String>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSession(session: SessionEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSessions(sessions: List<SessionEntity>)

    @Update
    suspend fun updateSession(session: SessionEntity)

    @Query(
        """
        UPDATE sessions
        SET cliProvider = :cliProvider,
            cliModel = :cliModel,
            isAgentOnline = 1,
            isRunning = :isRunning,
            queuedCount = :queuedCount,
            currentPrompt = :currentPrompt,
            queuePreview = :queuePreview,
            currentStartedAt = :currentStartedAt,
            lastActiveAt = :lastActiveAt
        WHERE projectId = :projectId
        """
    )
    suspend fun updateSessionRuntime(
        projectId: String,
        cliProvider: String,
        cliModel: String?,
        isRunning: Boolean,
        queuedCount: Int,
        currentPrompt: String?,
        queuePreview: String?,
        currentStartedAt: Long?,
        lastActiveAt: Long
    )

    @Query("UPDATE sessions SET lastSyncSeq = :lastSyncSeq WHERE projectId = :projectId")
    suspend fun updateLastSyncSeq(projectId: String, lastSyncSeq: Long)

    @Query(
        """
        UPDATE sessions
        SET isAgentOnline = :isOnline,
            lastActiveAt = :lastActiveAt
        WHERE projectId = :projectId
          AND lastActiveAt <= :lastActiveAt
        """
    )
    suspend fun updateAgentStatus(projectId: String, isOnline: Boolean, lastActiveAt: Long)

    @Query("UPDATE sessions SET isRunning = 0, currentPrompt = NULL, currentStartedAt = NULL WHERE projectId = :projectId AND isRunning = 1")
    suspend fun resetRunningState(projectId: String)

    @Query("DELETE FROM sessions WHERE id = :id")
    suspend fun deleteSession(id: String)

    @Query("DELETE FROM sessions WHERE projectId = :projectId")
    suspend fun deleteSessionByProjectId(projectId: String)

    @Query("DELETE FROM sessions")
    suspend fun deleteAllSessions()
}
