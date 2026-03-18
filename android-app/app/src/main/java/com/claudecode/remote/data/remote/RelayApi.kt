package com.claudecode.remote.data.remote

import com.claudecode.remote.data.model.CreateSessionRequest
import com.claudecode.remote.data.model.CreateSessionResponse
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

interface RelayApi {
    @POST("api/session")
    suspend fun createSession(@Body request: CreateSessionRequest): CreateSessionResponse

    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @POST("api/project/bind")
    suspend fun bindProject(
        @Header("Authorization") auth: String,
        @Body request: BindProjectRequest
    ): BindProjectResponse

    @POST("api/agent/wakeup")
    suspend fun wakeupAgent(
        @Header("Authorization") auth: String,
        @Body request: WakeupRequest
    ): WakeupResponse

    @GET("api/device/sync")
    suspend fun syncDevice(
        @Header("Authorization") auth: String
    ): SyncResponse
}

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
    @SerialName("client_type") val clientType: String,
    @SerialName("client_id") val clientId: String
)

@Serializable
data class LoginResponse(
    val token: String,
    @SerialName("expires_at") val expiresAt: String,
    val user: UserInfo
)

@Serializable
data class UserInfo(
    val id: Int,
    val username: String
)

@Serializable
data class BindProjectRequest(
    @SerialName("project_id") val projectId: String,
    @SerialName("agent_id") val agentId: String,
    val path: String,
    val name: String
)

@Serializable
data class BindProjectResponse(val success: Boolean)

@Serializable
data class WakeupRequest(@SerialName("agent_id") val agentId: String)

@Serializable
data class WakeupResponse(val status: String)

@Serializable
data class SyncResponse(
    @SerialName("agent_id") val agentId: String,
    val projects: List<ProjectInfo>
)

@Serializable
data class ProjectInfo(
    val id: String,
    val name: String,
    val path: String
)
