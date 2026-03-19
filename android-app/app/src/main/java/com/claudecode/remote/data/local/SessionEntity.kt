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
    val cliProvider: String,
    val cliModel: String?,
    val isAgentOnline: Boolean = true,
    val isRunning: Boolean = false,
    val queuedCount: Int = 0,
    val currentPrompt: String? = null,
    val queuePreview: String? = null,
    val currentStartedAt: Long? = null,
    val createdAt: Long,
    val lastActiveAt: Long
)
