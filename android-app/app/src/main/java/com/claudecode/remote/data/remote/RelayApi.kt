package com.claudecode.remote.data.remote

import com.claudecode.remote.data.model.CreateSessionRequest
import com.claudecode.remote.data.model.CreateSessionResponse
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Query

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

    @GET("api/update/check")
    suspend fun checkForUpdate(
        @Query("platform") platform: String,
        @Query("channel") channel: String,
        @Query("arch") arch: String,
        @Query("version") version: String,
        @Query("build") build: Int
    ): UpdateCheckResponse
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
    val name: String,
    @SerialName("cli_provider") val cliProvider: String = "claude",
    @SerialName("cli_model") val cliModel: String? = null
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
    val path: String,
    @SerialName("cli_provider") val cliProvider: String = "claude",
    @SerialName("cli_model") val cliModel: String? = null,
    val online: Boolean? = null
)

@Serializable
data class UpdateCheckResponse(
    val available: Boolean = false,
    @SerialName("releaseId") val releaseId: Int? = null,
    @SerialName("latestVersion") val latestVersion: String? = null,
    val build: Int? = null,
    @SerialName("minSupportedVersion") val minSupportedVersion: String? = null,
    val url: String? = null,
    @SerialName("downloadUrl") val downloadUrl: String? = null,
    val sha256: String? = null,
    val size: Long? = null,
    val notes: String? = null,
    val mandatory: Boolean? = null,
    val filename: String? = null
)
