package com.claudecode.remote.domain

import android.os.Build
import com.claudecode.remote.BuildConfig
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.remote.AuthSessionManager
import com.claudecode.remote.data.remote.DeviceLogUploadRequest
import com.claudecode.remote.data.remote.DeviceLogUploadResponse
import com.claudecode.remote.data.remote.RelayApi
import java.time.Instant

class MobileLogRepository(
    private val relayApiProvider: () -> RelayApi,
    private val authSessionManager: AuthSessionManager,
    private val tokenStore: TokenStore
) {
    suspend fun uploadLog(
        fileName: String,
        content: String,
        connectionNote: String? = null
    ): Result<DeviceLogUploadResponse> {
        return runCatching {
            val normalizedFileName = fileName.trim()
            val normalizedContent = content.replace("\r\n", "\n")
            require(normalizedFileName.isNotEmpty()) { "Log file name is required" }
            require(normalizedContent.isNotBlank()) { "Log content is empty" }

            val deviceId = tokenStore.getDeviceId()?.trim().orEmpty()
            require(deviceId.isNotEmpty()) { "Device ID is missing" }

            val token = authSessionManager.ensureValidToken(
                clientId = deviceId,
                forceRefresh = false
            ).getOrThrow()

            relayApiProvider().uploadDeviceLog(
                auth = "Bearer $token",
                request = DeviceLogUploadRequest(
                    fileName = normalizedFileName,
                    content = normalizedContent,
                    appVersion = BuildConfig.VERSION_NAME,
                    appBuild = BuildConfig.VERSION_CODE,
                    deviceModel = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                    clientTime = Instant.now().toString(),
                    source = "android",
                    connectionNote = connectionNote?.trim()?.takeIf { it.isNotEmpty() }
                )
            )
        }
    }
}
