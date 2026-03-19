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
    val createdAt: Long,
    val lastActiveAt: Long
)
