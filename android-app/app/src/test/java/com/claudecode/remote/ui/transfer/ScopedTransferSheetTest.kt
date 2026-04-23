package com.claudecode.remote.ui.transfer

import com.claudecode.remote.domain.TransferCenterItem
import com.claudecode.remote.domain.TransferReceiptItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ScopedTransferSheetTest {

    @Test
    fun buildTransferSenderLabelPrefersDeviceId() {
        val item = transferItem(
            senderType = "desktop",
            senderDeviceId = "device-1",
            senderAgentId = "agent-1",
            targetType = "project",
            targetId = "project-1",
        )

        assertEquals("desktop device-1", buildTransferSenderLabel(item))
    }

    @Test
    fun buildTransferTargetLabelFallsBackToAllMobile() {
        val item = transferItem(senderType = "desktop")

        val label = buildTransferTargetLabel(
            item = item,
            allMobileLabel = "All mobile",
            deviceLabel = "Device",
            projectLabel = "Project",
            workgroupLabel = "Workgroup",
        )

        assertEquals("All mobile", label)
    }

    @Test
    fun buildTransferScopeDetailsIncludesScopeExpiryAndDownloadState() {
        val item = transferItem(
            senderType = "desktop",
            targetType = "project",
            targetId = "project-1",
            projectId = "project-1",
            workgroupId = "workgroup-1",
            expiresAt = "2026-04-07T12:30:00Z",
            downloaded = true,
        )

        val details = buildTransferScopeDetails(
            item = item,
            projectPrefix = "Project",
            workgroupPrefix = "Workgroup",
            expiresPrefix = "Expires",
            downloadedLabel = "Downloaded",
            formatTimestamp = { "formatted:$it" },
        )

        assertEquals(
            listOf(
                "Project project-1",
                "Workgroup workgroup-1",
                "Expires formatted:2026-04-07T12:30:00Z",
                "Downloaded",
            ),
            details,
        )
    }

    @Test
    fun buildTransferReceiptTargetLabelPrefersDeviceThenAgentThenClientType() {
        val deviceReceipt = TransferReceiptItem(
            clientType = "android",
            agentId = "agent-1",
            deviceId = "device-1",
            status = "opened",
            note = null,
            createdAt = "2026-04-07T12:30:00Z",
        )
        val agentReceipt = TransferReceiptItem(
            clientType = "android",
            agentId = "agent-1",
            deviceId = null,
            status = "opened",
            note = null,
            createdAt = "2026-04-07T12:30:00Z",
        )
        val clientReceipt = TransferReceiptItem(
            clientType = "android",
            agentId = null,
            deviceId = null,
            status = "opened",
            note = null,
            createdAt = "2026-04-07T12:30:00Z",
        )

        assertEquals(
            "Device device-1",
            buildTransferReceiptTargetLabel(deviceReceipt, "Device", "Agent", "Unknown"),
        )
        assertEquals(
            "Agent agent-1",
            buildTransferReceiptTargetLabel(agentReceipt, "Device", "Agent", "Unknown"),
        )
        assertEquals(
            "android",
            buildTransferReceiptTargetLabel(clientReceipt, "Device", "Agent", "Unknown"),
        )
    }

    @Test
    fun transferFormattingHelpersReturnExpectedValues() {
        assertEquals("512 B", formatTransferFileSize(512))
        assertEquals("2.0 KB", formatTransferFileSize(2048))
        assertEquals("3.0 MB", formatTransferFileSize(3L * 1024L * 1024L))
        assertEquals("bad-value", formatTransferTimestamp("bad-value"))
        assertEquals("-", formatTransferTimestamp(""))
    }

    @Test
    fun buildTransferScopeDetailsStaysEmptyWithoutMetadata() {
        val item = transferItem(
            senderType = "desktop",
            targetType = "project",
            targetId = "project-1",
        )

        val details = buildTransferScopeDetails(
            item = item,
            projectPrefix = "Project",
            workgroupPrefix = "Workgroup",
            expiresPrefix = "Expires",
            downloadedLabel = "Downloaded",
            formatTimestamp = { it },
        )

        assertTrue(details.isEmpty())
    }

    @Test
    fun mergeUpdatedTransferReplacesMatchingItemOnly() {
        val original = transferItem(senderType = "desktop")
        val untouched = transferItem(senderType = "mobile", targetId = "other").copy(id = "transfer-2")
        val updated = original.copy(fileName = "updated.txt", downloaded = true)

        val merged = mergeUpdatedTransfer(listOf(original, untouched), updated)

        assertEquals(listOf(updated, untouched), merged)
        assertSame(untouched, merged[1])
    }

    @Test
    fun resolveTransferActionMessageFallsBackWhenMessageIsBlank() {
        assertEquals(
            "fallback",
            resolveTransferActionMessage(IllegalStateException("   "), "fallback"),
        )
        assertEquals(
            "network down",
            resolveTransferActionMessage(IllegalStateException("network down"), "fallback"),
        )
        assertEquals(
            "fallback",
            resolveTransferActionMessage(null, "fallback"),
        )
    }

    private fun transferItem(
        senderType: String,
        senderDeviceId: String? = null,
        senderAgentId: String? = null,
        targetType: String? = null,
        targetId: String? = null,
        projectId: String? = null,
        workgroupId: String? = null,
        expiresAt: String? = null,
        downloaded: Boolean = false,
    ): TransferCenterItem = TransferCenterItem(
        id = "transfer-1",
        fileName = "report.txt",
        mimeType = "text/plain",
        sizeBytes = 1024L,
        status = "available",
        createdAt = "2026-04-07T12:00:00Z",
        senderType = senderType,
        senderAgentId = senderAgentId,
        senderDeviceId = senderDeviceId,
        targetType = targetType,
        targetId = targetId,
        projectId = projectId,
        workgroupId = workgroupId,
        expiresAt = expiresAt,
        receipts = emptyList(),
        localPath = null,
        localUri = null,
        downloaded = downloaded,
    )
}
