package com.claudecode.remote.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Session(
    val id: String,
    val name: String,
    val agentId: String,
    val projectId: String,
    val projectPath: String,
    val cliProvider: String = "claude",
    val cliModel: String? = null,
    val isAgentOnline: Boolean = true,
    val isRunning: Boolean = false,
    val queuedCount: Int = 0,
    val currentPrompt: String? = null,
    val queuePreview: String? = null,
    val currentStartedAt: Long? = null,
    val createdAt: Long,
    val lastActiveAt: Long
)

@Serializable
data class CreateSessionRequest(
    val type: String = "device",
    @SerialName("device_id") val deviceId: String
)

@Serializable
data class CreateSessionResponse(
    val token: String,
    @SerialName("expires_at") val expiresAt: String
)
