package com.claudecode.remote.ui.transfer;

import com.claudecode.remote.domain.TransferCenterItem;
import com.claudecode.remote.domain.TransferReceiptItem;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import kotlin.jvm.functions.Function1;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class ScopedTransferSheetJavaTest {

    @Test
    public void buildTransferSenderLabelPrefersDeviceId() {
        TransferCenterItem item = transferItem(
                "desktop",
                "device-1",
                "agent-1",
                "project",
                "project-1",
                null,
                null,
                null,
                false
        );

        assertEquals("desktop device-1", TransferPresentationFormatterKt.buildTransferSenderLabel(item));
    }

    @Test
    public void buildTransferTargetLabelFallsBackToAllMobile() {
        TransferCenterItem item = transferItem(
                "desktop",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                false
        );

        String label = TransferPresentationFormatterKt.buildTransferTargetLabel(
                item,
                "All mobile",
                "Device",
                "Project",
                "Workgroup"
        );

        assertEquals("All mobile", label);
    }

    @Test
    public void buildTransferScopeDetailsIncludesScopeExpiryAndDownloadState() {
        TransferCenterItem item = transferItem(
                "desktop",
                null,
                null,
                "project",
                "project-1",
                "project-1",
                "workgroup-1",
                "2026-04-07T12:30:00Z",
                true
        );

        List<String> details = TransferPresentationFormatterKt.buildTransferScopeDetails(
                item,
                "Project",
                "Workgroup",
                "Expires",
                "Downloaded",
                new Function1<String, String>() {
                    @Override
                    public String invoke(String value) {
                        return "formatted:" + value;
                    }
                }
        );

        assertEquals(
                Arrays.asList(
                        "Project project-1",
                        "Workgroup workgroup-1",
                        "Expires formatted:2026-04-07T12:30:00Z",
                        "Downloaded"
                ),
                details
        );
    }

    @Test
    public void buildTransferReceiptTargetLabelPrefersDeviceThenAgentThenClientType() {
        TransferReceiptItem deviceReceipt = new TransferReceiptItem(
                "android",
                "agent-1",
                "device-1",
                "opened",
                null,
                "2026-04-07T12:30:00Z"
        );
        TransferReceiptItem agentReceipt = new TransferReceiptItem(
                "android",
                "agent-1",
                null,
                "opened",
                null,
                "2026-04-07T12:30:00Z"
        );
        TransferReceiptItem clientReceipt = new TransferReceiptItem(
                "android",
                null,
                null,
                "opened",
                null,
                "2026-04-07T12:30:00Z"
        );

        assertEquals(
                "Device device-1",
                TransferPresentationFormatterKt.buildTransferReceiptTargetLabel(deviceReceipt, "Device", "Agent", "Unknown")
        );
        assertEquals(
                "Agent agent-1",
                TransferPresentationFormatterKt.buildTransferReceiptTargetLabel(agentReceipt, "Device", "Agent", "Unknown")
        );
        assertEquals(
                "android",
                TransferPresentationFormatterKt.buildTransferReceiptTargetLabel(clientReceipt, "Device", "Agent", "Unknown")
        );
    }

    @Test
    public void transferFormattingHelpersReturnExpectedValues() {
        assertEquals("512 B", TransferPresentationFormatterKt.formatTransferFileSize(512));
        assertEquals("2.0 KB", TransferPresentationFormatterKt.formatTransferFileSize(2048));
        assertEquals("3.0 MB", TransferPresentationFormatterKt.formatTransferFileSize(3L * 1024L * 1024L));
        assertEquals("bad-value", TransferPresentationFormatterKt.formatTransferTimestamp("bad-value"));
        assertEquals("-", TransferPresentationFormatterKt.formatTransferTimestamp(""));
    }

    @Test
    public void buildTransferScopeDetailsStaysEmptyWithoutMetadata() {
        TransferCenterItem item = transferItem(
                "desktop",
                null,
                null,
                "project",
                "project-1",
                null,
                null,
                null,
                false
        );

        List<String> details = TransferPresentationFormatterKt.buildTransferScopeDetails(
                item,
                "Project",
                "Workgroup",
                "Expires",
                "Downloaded",
                new Function1<String, String>() {
                    @Override
                    public String invoke(String value) {
                        return value;
                    }
                }
        );

        assertTrue(details.isEmpty());
    }

    private static TransferCenterItem transferItem(
            String senderType,
            String senderDeviceId,
            String senderAgentId,
            String targetType,
            String targetId,
            String projectId,
            String workgroupId,
            String expiresAt,
            boolean downloaded
    ) {
        return new TransferCenterItem(
                "transfer-1",
                "report.txt",
                "text/plain",
                1024L,
                "available",
                "2026-04-07T12:00:00Z",
                senderType,
                senderAgentId,
                senderDeviceId,
                targetType,
                targetId,
                projectId,
                workgroupId,
                expiresAt,
                Collections.emptyList(),
                null,
                null,
                downloaded
        );
    }
}
