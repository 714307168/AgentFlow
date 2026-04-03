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
    @Query(
        """
        SELECT * FROM messages
        WHERE projectId = :projectId
          AND source != 'workgroup'
          AND COALESCE(conversationId, '') = COALESCE(
            (SELECT activeConversationId FROM sessions WHERE projectId = :projectId LIMIT 1),
            ''
          )
        ORDER BY timestamp ASC, syncSeq ASC, id ASC
        """
    )
    fun getMessagesByProject(projectId: String): Flow<List<MessageEntity>>

    @Query(
        """
        SELECT * FROM messages
        WHERE projectId = :projectId
          AND source != 'workgroup'
          AND COALESCE(conversationId, '') = COALESCE(
            (SELECT activeConversationId FROM sessions WHERE projectId = :projectId LIMIT 1),
            ''
          )
        ORDER BY timestamp ASC, syncSeq ASC, id ASC
        """
    )
    suspend fun getMessagesByProjectSnapshot(projectId: String): List<MessageEntity>

    @Query(
        """
        SELECT * FROM messages
        WHERE projectId = :projectId
          AND source != 'workgroup'
          AND COALESCE(conversationId, '') = COALESCE(
            (SELECT activeConversationId FROM sessions WHERE projectId = :projectId LIMIT 1),
            ''
          )
          AND type IN ('TEXT', 'FILE')
        ORDER BY timestamp ASC, syncSeq ASC, id ASC
        """
    )
    fun getConversationMessagesByProject(projectId: String): Flow<List<MessageEntity>>

    @Query(
        """
        SELECT * FROM messages
        WHERE projectId = :projectId
          AND source != 'workgroup'
          AND COALESCE(conversationId, '') = COALESCE(
            (SELECT activeConversationId FROM sessions WHERE projectId = :projectId LIMIT 1),
            ''
          )
          AND type IN ('TEXT', 'FILE')
        ORDER BY timestamp ASC, syncSeq ASC, id ASC
        """
    )
    suspend fun getConversationMessagesByProjectSnapshot(projectId: String): List<MessageEntity>

    @Query("SELECT * FROM messages WHERE id = :messageId LIMIT 1")
    suspend fun getMessageById(messageId: String): MessageEntity?

    @Query(
        """
        SELECT * FROM messages
        WHERE projectId = :projectId
          AND source != 'workgroup'
          AND type IN ('TEXT', 'FILE')
        ORDER BY timestamp DESC, syncSeq DESC, id DESC
        LIMIT 1
        """
    )
    suspend fun getLatestConversationMessageByProject(projectId: String): MessageEntity?

    @Query(
        """
        SELECT * FROM messages
        WHERE id IN (
            SELECT latest.id
            FROM messages AS latest
            WHERE latest.type IN ('TEXT', 'FILE')
              AND latest.source != 'workgroup'
              AND latest.id = (
                  SELECT inner_message.id
                  FROM messages AS inner_message
                  WHERE inner_message.projectId = latest.projectId
                    AND inner_message.source != 'workgroup'
                    AND inner_message.type IN ('TEXT', 'FILE')
                  ORDER BY inner_message.timestamp DESC, inner_message.syncSeq DESC, inner_message.id DESC
                  LIMIT 1
              )
        )
        ORDER BY timestamp DESC, syncSeq DESC, id DESC
        """
    )
    fun getLatestConversationMessages(): Flow<List<MessageEntity>>

    @Query(
        """
        SELECT * FROM messages
        WHERE id IN (
            SELECT latest.id
            FROM messages AS latest
            WHERE latest.type IN ('TEXT', 'FILE')
              AND latest.source != 'workgroup'
              AND latest.id = (
                  SELECT inner_message.id
                  FROM messages AS inner_message
                  WHERE inner_message.projectId = latest.projectId
                    AND inner_message.source != 'workgroup'
                    AND inner_message.type IN ('TEXT', 'FILE')
                  ORDER BY inner_message.timestamp DESC, inner_message.syncSeq DESC, inner_message.id DESC
                  LIMIT 1
              )
        )
        ORDER BY timestamp DESC, syncSeq DESC, id DESC
        """
    )
    suspend fun getLatestConversationMessagesSnapshot(): List<MessageEntity>

    @Query(
        """
        SELECT * FROM messages
        WHERE projectId = :projectId
          AND source != 'workgroup'
          AND COALESCE(conversationId, '') = COALESCE(:conversationId, '')
          AND syncSeq > 0
          AND (:beforeSeq IS NULL OR syncSeq < :beforeSeq)
        ORDER BY syncSeq DESC
        LIMIT :limit
        """
    )
    suspend fun getSyncDigestMessages(
        projectId: String,
        conversationId: String?,
        beforeSeq: Long?,
        limit: Int
    ): List<MessageEntity>

    @Query(
        """
        SELECT
            MIN(CASE WHEN syncSeq > 0 THEN syncSeq END) AS earliestSyncSeq,
            MAX(CASE WHEN syncSeq > 0 THEN syncSeq END) AS latestSyncSeq,
            COUNT(CASE WHEN syncSeq > 0 THEN 1 END) AS messageCount
        FROM messages
        WHERE projectId = :projectId
          AND source != 'workgroup'
          AND COALESCE(conversationId, '') = COALESCE(:conversationId, '')
        """
    )
    suspend fun getConversationSyncBounds(projectId: String, conversationId: String?): ProjectSyncBounds?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessage(message: MessageEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMessages(messages: List<MessageEntity>)

    @Query("DELETE FROM messages WHERE projectId = :projectId")
    suspend fun deleteMessagesByProject(projectId: String)

    @Query("DELETE FROM messages WHERE id = :messageId")
    suspend fun deleteMessageById(messageId: String)

    @Query("DELETE FROM messages WHERE source = :source")
    suspend fun deleteMessagesBySource(source: String): Int

    @Query(
        """
        DELETE FROM messages
        WHERE projectId = :projectId
          AND source != 'workgroup'
          AND id NOT IN (
            SELECT id FROM messages
            WHERE projectId = :projectId
              AND source != 'workgroup'
            ORDER BY syncSeq DESC, timestamp DESC, id DESC
            LIMIT :keepCount
          )
        """
    )
    suspend fun pruneProjectMessages(projectId: String, keepCount: Int)

    @Query("DELETE FROM messages")
    suspend fun deleteAllMessages()
}
