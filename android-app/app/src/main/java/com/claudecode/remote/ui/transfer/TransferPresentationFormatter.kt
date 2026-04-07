package com.claudecode.remote.ui.transfer

import com.claudecode.remote.domain.TransferCenterItem
import com.claudecode.remote.domain.TransferReceiptItem
import java.text.SimpleDateFormat
import java.time.Instant
import java.util.Date
import java.util.Locale

fun buildTransferSenderLabel(item: TransferCenterItem): String {
    val senderType = item.senderType.ifBlank { "desktop" }
    return when {
        !item.senderDeviceId.isNullOrBlank() -> "$senderType ${item.senderDeviceId}"
        !item.senderAgentId.isNullOrBlank() -> "$senderType ${item.senderAgentId}"
        else -> senderType
    }
}

fun buildTransferTargetLabel(
    item: TransferCenterItem,
    allMobileLabel: String,
    deviceLabel: String,
    projectLabel: String,
    workgroupLabel: String
): String {
    val targetType = item.targetType?.takeIf { it.isNotBlank() } ?: return allMobileLabel
    val targetId = item.targetId?.takeIf { it.isNotBlank() }
    return when (targetType) {
        "device" -> listOf(deviceLabel, targetId).filterNotNull().joinToString(" ")
        "project" -> listOf(projectLabel, targetId).filterNotNull().joinToString(" ")
        "workgroup" -> listOf(workgroupLabel, targetId).filterNotNull().joinToString(" ")
        else -> listOf(targetType, targetId).filterNotNull().joinToString(" ")
    }
}

fun buildTransferScopeDetails(
    item: TransferCenterItem,
    projectPrefix: String,
    workgroupPrefix: String,
    expiresPrefix: String,
    downloadedLabel: String,
    formatTimestamp: (String) -> String
): List<String> {
    val parts = mutableListOf<String>()
    if (!item.projectId.isNullOrBlank()) {
        parts += "$projectPrefix ${item.projectId}"
    }
    if (!item.workgroupId.isNullOrBlank()) {
        parts += "$workgroupPrefix ${item.workgroupId}"
    }
    if (!item.expiresAt.isNullOrBlank()) {
        parts += "$expiresPrefix ${formatTimestamp(item.expiresAt)}"
    }
    if (item.downloaded) {
        parts += downloadedLabel
    }
    return parts
}

fun buildTransferReceiptTargetLabel(
    receipt: TransferReceiptItem,
    devicePrefix: String,
    agentPrefix: String,
    unknownLabel: String
): String {
    return when {
        !receipt.deviceId.isNullOrBlank() -> "$devicePrefix ${receipt.deviceId}"
        !receipt.agentId.isNullOrBlank() -> "$agentPrefix ${receipt.agentId}"
        !receipt.clientType.isBlank() -> receipt.clientType
        else -> unknownLabel
    }
}

fun formatTransferTimestamp(value: String): String {
    return runCatching {
        val instant = Instant.parse(value)
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(instant.toEpochMilli()))
    }.getOrDefault(value.ifBlank { "-" })
}

fun formatTransferFileSize(sizeBytes: Long): String =
    when {
        sizeBytes >= 1024 * 1024 -> String.format(Locale.US, "%.1f MB", sizeBytes / (1024f * 1024f))
        sizeBytes >= 1024 -> String.format(Locale.US, "%.1f KB", sizeBytes / 1024f)
        else -> "$sizeBytes B"
    }
