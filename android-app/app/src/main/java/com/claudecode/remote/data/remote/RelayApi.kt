package com.claudecode.remote.data.remote

import com.claudecode.remote.data.model.CreateSessionRequest
import com.claudecode.remote.data.model.CreateSessionResponse
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.Headers
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

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

    @GET("api/device/sync/meta")
    suspend fun syncDeviceMeta(
        @Header("Authorization") auth: String,
        @Query("since_revision") sinceRevision: String? = null
    ): SyncMetaResponse

    @POST("api/device/sync/delta")
    @Headers("X-AgentFlow-Request-Compression: gzip")
    suspend fun syncDeviceDelta(
        @Header("Authorization") auth: String,
        @Body request: SyncDeltaRequest
    ): SyncDeltaResponse

    @GET("api/update/check")
    suspend fun checkForUpdate(
        @Query("platform") platform: String,
        @Query("channel") channel: String,
        @Query("arch") arch: String,
        @Query("version") version: String,
        @Query("build") build: Int
    ): UpdateCheckResponse

    @GET("api/workgroups/registry")
    suspend fun searchWorkgroupRegistry(
        @Header("Authorization") auth: String,
        @Query("q") query: String
    ): WorkgroupRegistrySearchResponse

    @GET("api/workgroups/registry/mine")
    suspend fun listMyWorkgroupRegistry(
        @Header("Authorization") auth: String
    ): WorkgroupRegistrySearchResponse

    @GET("api/workgroups/registry/members")
    suspend fun getWorkgroupRegistryMembers(
        @Header("Authorization") auth: String,
        @Query("group_number") groupNumber: String? = null,
        @Query("host_agent_id") hostAgentId: String? = null,
        @Query("workgroup_id") workgroupId: String? = null
    ): WorkgroupRegistryMembersResponse

    @POST("api/device/logs")
    @Headers("X-AgentFlow-Request-Compression: gzip")
    suspend fun uploadDeviceLog(
        @Header("Authorization") auth: String,
        @Body request: DeviceLogUploadRequest
    ): DeviceLogUploadResponse

    @GET("api/transfers")
    suspend fun listTransfers(
        @Header("Authorization") auth: String,
        @Query("limit") limit: Int = 20,
        @Query("target_type") targetType: String? = null,
        @Query("target_id") targetId: String? = null,
        @Query("project_id") projectId: String? = null,
        @Query("workgroup_id") workgroupId: String? = null,
        @Query("include_receipts") includeReceipts: Boolean = false
    ): List<TransferRecordResponse>

    @GET("api/transfers/{id}")
    suspend fun getTransferDetail(
        @Header("Authorization") auth: String,
        @Path("id") transferId: String
    ): TransferRecordResponse

    @Streaming
    @GET("api/transfers/{id}/download")
    suspend fun downloadTransfer(
        @Header("Authorization") auth: String,
        @Path("id") transferId: String
    ): ResponseBody

    @POST("api/transfers/{id}/receipts")
    suspend fun createTransferReceipt(
        @Header("Authorization") auth: String,
        @Path("id") transferId: String,
        @Body request: TransferReceiptRequest
    ): TransferReceiptResponse

    @POST("api/workgroups/registry/join")
    suspend fun joinWorkgroupRegistry(
        @Header("Authorization") auth: String,
        @Body request: JoinWorkgroupRegistryRequest
    ): JoinWorkgroupRegistryResponse

    @POST("api/workgroups/registry/leave")
    suspend fun leaveWorkgroupRegistry(
        @Header("Authorization") auth: String,
        @Body request: ResolveWorkgroupRegistryRequest
    ): SuccessResponse

    @POST("api/workgroups/registry/kick")
    suspend fun kickWorkgroupRegistryMember(
        @Header("Authorization") auth: String,
        @Body request: KickWorkgroupRegistryMemberRequest
    ): SuccessResponse
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
    @SerialName("group_name") val groupName: String? = null,
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
    val revision: String? = null,
    @SerialName("project_count") val projectCount: Int? = null,
    val projects: List<ProjectInfo>
)

@Serializable
data class SyncMetaResponse(
    @SerialName("agent_id") val agentId: String,
    val revision: String,
    @SerialName("project_count") val projectCount: Int = 0,
    val changed: Boolean = true
)

@Serializable
data class SyncKnownProject(
    @SerialName("project_id") val projectId: String,
    val signature: String
)

@Serializable
data class SyncDeltaRequest(
    @SerialName("since_revision") val sinceRevision: String? = null,
    @SerialName("known_projects") val knownProjects: List<SyncKnownProject> = emptyList(),
    @SerialName("known_project_ids") val knownProjectIds: List<String> = emptyList()
)

@Serializable
data class SyncDeltaResponse(
    @SerialName("agent_id") val agentId: String,
    val revision: String,
    @SerialName("project_count") val projectCount: Int = 0,
    val changed: Boolean = true,
    @SerialName("project_upserts") val projectUpserts: List<ProjectInfo> = emptyList(),
    @SerialName("project_removes") val projectRemoves: List<String> = emptyList()
)

@Serializable
data class DeviceLogUploadRequest(
    @SerialName("file_name") val fileName: String,
    val content: String,
    @SerialName("app_version") val appVersion: String? = null,
    @SerialName("app_build") val appBuild: Int? = null,
    @SerialName("device_model") val deviceModel: String? = null,
    @SerialName("client_time") val clientTime: String? = null,
    val source: String = "android",
    @SerialName("connection_note") val connectionNote: String? = null,
    @SerialName("trace_ids") val traceIds: List<String>? = null,
    @SerialName("workgroup_ids") val workgroupIds: List<String>? = null
)

@Serializable
data class DeviceLogUploadResponse(
    val success: Boolean = false,
    @SerialName("log_id") val logId: String? = null,
    @SerialName("uploaded_at") val uploadedAt: String? = null
)

@Serializable
data class TransferRecordResponse(
    val id: String,
    @SerialName("sender_type") val senderType: String = "",
    @SerialName("sender_agent_id") val senderAgentId: String? = null,
    @SerialName("sender_device_id") val senderDeviceId: String? = null,
    @SerialName("target_type") val targetType: String? = null,
    @SerialName("target_id") val targetId: String? = null,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("workgroup_id") val workgroupId: String? = null,
    @SerialName("file_name") val fileName: String,
    @SerialName("mime_type") val mimeType: String = "application/octet-stream",
    @SerialName("size_bytes") val sizeBytes: Long = 0L,
    val sha256: String = "",
    val status: String = "available",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("download_url") val downloadUrl: String? = null,
    val receipts: List<TransferReceiptResponse> = emptyList()
)

@Serializable
data class TransferReceiptRequest(
    val status: String,
    val note: String? = null
)

@Serializable
data class TransferReceiptResponse(
    val id: Long = 0L,
    @SerialName("client_type") val clientType: String = "",
    @SerialName("agent_id") val agentId: String? = null,
    @SerialName("device_id") val deviceId: String? = null,
    val status: String = "",
    val note: String? = null,
    @SerialName("created_at") val createdAt: String = ""
)

@Serializable
data class ProjectInfo(
    val id: String,
    @SerialName("agent_id") val agentId: String = "",
    val name: String,
    val path: String,
    @SerialName("group_name") val groupName: String? = null,
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

@Serializable
data class WorkgroupRegistrySearchResponse(
    val records: List<WorkgroupRegistryRecord> = emptyList()
)

@Serializable
data class WorkgroupRegistryMembersResponse(
    val record: WorkgroupRegistryRecord,
    val members: List<WorkgroupRegistryMember> = emptyList()
)

@Serializable
data class JoinWorkgroupRegistryRequest(
    @SerialName("group_number") val groupNumber: String
)

@Serializable
data class JoinWorkgroupRegistryResponse(
    val success: Boolean = false,
    val joined: Boolean = false,
    @SerialName("granted_access") val grantedAccess: Boolean = false,
    val record: WorkgroupRegistryRecord
)

@Serializable
data class ResolveWorkgroupRegistryRequest(
    @SerialName("group_number") val groupNumber: String? = null,
    @SerialName("host_agent_id") val hostAgentId: String? = null,
    @SerialName("workgroup_id") val workgroupId: String? = null
)

@Serializable
data class KickWorkgroupRegistryMemberRequest(
    @SerialName("group_number") val groupNumber: String? = null,
    @SerialName("host_agent_id") val hostAgentId: String? = null,
    @SerialName("workgroup_id") val workgroupId: String? = null,
    @SerialName("user_id") val userId: Int
)

@Serializable
data class SuccessResponse(
    val success: Boolean = false
)

@Serializable
data class WorkgroupRegistryRecord(
    @SerialName("groupNumber") val groupNumber: String,
    @SerialName("workgroupId") val workgroupId: String,
    @SerialName("hostAgentId") val hostAgentId: String,
    val name: String,
    val description: String? = null,
    @SerialName("ownerUsername") val ownerUsername: String? = null,
    @SerialName("memberCount") val memberCount: Int = 0,
    @SerialName("canManage") val canManage: Boolean = false,
    val joined: Boolean = false,
    @SerialName("updatedAt") val updatedAt: Long = 0L
)

@Serializable
data class WorkgroupRegistryMember(
    @SerialName("userId") val userId: Int,
    val username: String,
    @SerialName("isOwner") val isOwner: Boolean = false,
    @SerialName("joinedAt") val joinedAt: Long = 0L
)
