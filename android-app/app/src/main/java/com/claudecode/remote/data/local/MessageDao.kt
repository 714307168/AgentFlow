package com.claudecode.remote.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

data class ProjectSyncBounds(
    val earliestSyncSeq: Long?,
    val latestSyncSeq: Long?,
    val messageCount: Int
)

@Dao
interface MessageDao {
    @Query("SELECT * FROM messages WHERE projectId = :projectId ORDER BY timestamp ASC")
    fun getMessagesByProject(projectId: String): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages WHERE id = :messageId LIMIT 1")
    suspend fun getMessageById(messageId: String): MessageEntity?

    @Query(
        """
        SELECT
            MIN(CASE WHEN syncSeq > 0 THEN syncSeq END) AS earliestSyncSeq,
            MAX(CASE WHEN syncSeq > 0 THEN syncSeq END) AS latestSyncSeq,
            COUNT(CASE WHEN syncSeq > 0 THEN 1 END) AS messageCount
        FROM messages
        WHERE projectId = :projectId
        """
    )
    suspend fun getProjectSyncBounds(projectId: String): ProjectSyncBounds?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: MessageEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<MessageEntity>)

    @Query("DELETE FROM messages WHERE projectId = :projectId")
    suspend fun deleteMessagesByProject(projectId: String)

    @Query(
        """
        DELETE FROM messages
        WHERE projectId = :projectId
          AND id NOT IN (
            SELECT id FROM messages
            WHERE projectId = :projectId
            ORDER BY syncSeq DESC, timestamp DESC, id DESC
            LIMIT :keepCount
          )
        """
    )
    suspend fun pruneProjectMessages(projectId: String, keepCount: Int)

    @Query("DELETE FROM messages")
    suspend fun deleteAllMessages()
}
