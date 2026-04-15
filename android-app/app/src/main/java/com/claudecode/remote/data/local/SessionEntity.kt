package com.claudecode.remote.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey val id: String,
    val name: String,
    val agentId: String,
    val projectId: String,
    val projectPath: String,
    val groupName: String? = null,
    val cliProvider: String,
    val cliModel: String?,
    val isAgentOnline: Boolean = true,
    val isRunning: Boolean = false,
    val queuedCount: Int = 0,
    val currentPrompt: String? = null,
    val queuePreview: String? = null,
    val queueJson: String? = null,
    val currentStartedAt: Long? = null,
    val lastSyncSeq: Long = 0,
    val activeConversationId: String? = null,
    val activeConversationTitle: String? = null,
    val conversationsJson: String? = null,
    val snapshotRevision: String? = null,
    val projectSignature: String? = null,
    val syncBucket: String? = null,
    val createdAt: Long,
    val lastActiveAt: Long
)
