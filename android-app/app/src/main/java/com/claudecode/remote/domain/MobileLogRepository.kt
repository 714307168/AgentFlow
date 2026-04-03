package com.claudecode.remote.domain

import android.os.Build
import com.claudecode.remote.BuildConfig
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.remote.AuthSessionManager
import com.claudecode.remote.data.remote.DeviceLogUploadRequest
import com.claudecode.remote.data.remote.DeviceLogUploadResponse
import com.claudecode.remote.data.remote.RelayApi
import java.time.Instant
import kotlin.text.RegexOption.IGNORE_CASE

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
            val traceIds = extractIds(normalizedContent, TRACE_ID_PATTERN)
            val workgroupIds = extractIds(normalizedContent, WORKGROUP_ID_PATTERN)

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
                    connectionNote = connectionNote?.trim()?.takeIf { it.isNotEmpty() },
                    traceIds = traceIds,
                    workgroupIds = workgroupIds
                )
            )
        }
    }

    private fun extractIds(content: String, pattern: Regex): List<String>? {
        val values = LinkedHashSet<String>()
        pattern.findAll(content).forEach { match ->
            val rawValue = match.groupValues.getOrNull(1).orEmpty()
            val value = rawValue.trim().trim('\"', '\'', '.', ',', ';', ':', '(', ')', '[', ']', '{', '}', '<', '>')
            if (value.isNotEmpty()) {
                values += value
            }
            if (values.size >= MAX_EXTRACTED_IDS) {
                return@forEach
            }
        }
        return values.takeIf { it.isNotEmpty() }?.toList()
    }

    companion object {
        private const val MAX_EXTRACTED_IDS = 20
        private val TRACE_ID_PATTERN = Regex(
            pattern = """(?:trace[_-]?id["=: ]+|traceId["=: ]+)([a-z0-9:-]{6,})""",
            option = IGNORE_CASE
        )
        private val WORKGROUP_ID_PATTERN = Regex(
            pattern = """(?:workgroup[_-]?id["=: ]+|workgroupId["=: ]+)([a-z0-9._:-]{3,})""",
            option = IGNORE_CASE
        )
    }
}
