package com.claudecode.remote.domain

import android.content.Context
import android.os.Environment
import androidx.core.content.FileProvider
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.remote.AuthSessionManager
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.data.remote.TransferReceiptRequest
import com.claudecode.remote.data.remote.TransferRecordResponse
import java.io.File
import java.io.FileOutputStream

data class TransferReceiptItem(
    val clientType: String,
    val agentId: String?,
    val deviceId: String?,
    val status: String,
    val note: String?,
    val createdAt: String
)

data class TransferCenterItem(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val status: String,
    val createdAt: String,
    val senderType: String,
    val senderAgentId: String?,
    val senderDeviceId: String?,
    val targetType: String?,
    val targetId: String?,
    val projectId: String?,
    val workgroupId: String?,
    val expiresAt: String?,
    val receipts: List<TransferReceiptItem> = emptyList(),
    val localPath: String? = null,
    val localUri: String? = null,
    val downloaded: Boolean = false
)

class TransferRepository(
    private val relayApiProvider: () -> RelayApi,
    private val authSessionManager: AuthSessionManager,
    private val tokenStore: TokenStore,
    private val context: Context
) {
    suspend fun listRecentTransfers(
        limit: Int = 20,
        targetType: String? = null,
        targetId: String? = null,
        projectId: String? = null,
        workgroupId: String? = null
    ): Result<List<TransferCenterItem>> {
        return runCatching {
            val token = ensureToken()
            relayApiProvider().listTransfers(
                auth = "Bearer $token",
                limit = limit.coerceIn(1, 50),
                targetType = targetType?.trim()?.ifBlank { null },
                targetId = targetId?.trim()?.ifBlank { null },
                projectId = projectId?.trim()?.ifBlank { null },
                workgroupId = workgroupId?.trim()?.ifBlank { null },
                includeReceipts = true
            ).map { it.toTransferCenterItem() }
        }
    }

    suspend fun downloadTransfer(transferId: String): Result<TransferCenterItem> {
        return runCatching {
            val token = ensureToken()
            val detail = relayApiProvider().getTransferDetail(
                auth = "Bearer $token",
                transferId = transferId
            )
            val targetFile = resolveTransferFile(detail.id, detail.fileName)
            targetFile.parentFile?.mkdirs()
            relayApiProvider().downloadTransfer(
                auth = "Bearer $token",
                transferId = transferId
            ).byteStream().use { input ->
                FileOutputStream(targetFile).use { output ->
                    input.copyTo(output)
                }
            }
            postReceipt(token, transferId, "delivered")
            detail.toTransferCenterItem()
        }
    }

    suspend fun markTransferOpened(transferId: String): Result<Unit> {
        return runCatching {
            val token = ensureToken()
            postReceipt(token, transferId, "opened")
        }
    }

    private suspend fun ensureToken(): String {
        val deviceId = tokenStore.getDeviceId()?.trim().orEmpty()
        require(deviceId.isNotEmpty()) { "Device ID is missing" }
        return authSessionManager.ensureValidToken(
            clientId = deviceId,
            forceRefresh = false
        ).getOrThrow()
    }

    private suspend fun postReceipt(token: String, transferId: String, status: String) {
        relayApiProvider().createTransferReceipt(
            auth = "Bearer $token",
            transferId = transferId,
            request = TransferReceiptRequest(status = status)
        )
    }

    private fun TransferRecordResponse.toTransferCenterItem(): TransferCenterItem {
        val localFile = resolveTransferFile(id, fileName)
        val downloaded = localFile.exists() && localFile.isFile
        val localUri = if (downloaded) {
            FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                localFile
            ).toString()
        } else {
            null
        }
        return TransferCenterItem(
            id = id,
            fileName = fileName,
            mimeType = mimeType.ifBlank { "application/octet-stream" },
            sizeBytes = sizeBytes,
            status = status.ifBlank { "available" },
            createdAt = createdAt,
            senderType = senderType,
            senderAgentId = senderAgentId,
            senderDeviceId = senderDeviceId,
            targetType = targetType,
            targetId = targetId,
            projectId = projectId,
            workgroupId = workgroupId,
            expiresAt = expiresAt,
            receipts = receipts.map { receipt ->
                TransferReceiptItem(
                    clientType = receipt.clientType,
                    agentId = receipt.agentId,
                    deviceId = receipt.deviceId,
                    status = receipt.status,
                    note = receipt.note,
                    createdAt = receipt.createdAt
                )
            },
            localPath = localFile.absolutePath,
            localUri = localUri,
            downloaded = downloaded
        )
    }

    private fun resolveTransferFile(transferId: String, fileName: String): File {
        val downloadRoot = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.cacheDir
        val transferDirectory = File(downloadRoot, "relay-transfers").apply { mkdirs() }
        val sanitizedName = sanitizeFileName(fileName)
        return File(transferDirectory, "${transferId}_${sanitizedName}")
    }

    private fun sanitizeFileName(fileName: String): String {
        val trimmed = fileName.trim()
        val sanitized = trimmed.replace(Regex("""[<>:"/\\|?*\u0000-\u001F]"""), "_")
        return sanitized.ifBlank { "transfer.bin" }
    }
}
