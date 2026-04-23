package com.claudecode.remote.ui.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatScreenTest {

    @Test
    fun projectTransferEntryFollowsFileDownloadPermission() {
        assertTrue(isProjectTransferEntryEnabled(fileDownloadsAllowed = true))
        assertFalse(isProjectTransferEntryEnabled(fileDownloadsAllowed = false))
    }

    @Test
    fun projectTransferLoadingRequiresProjectAndPermission() {
        assertTrue(
            shouldLoadProjectTransfers(
                projectId = "project-a",
                transfersEnabled = true
            )
        )
        assertFalse(
            shouldLoadProjectTransfers(
                projectId = "",
                transfersEnabled = true
            )
        )
        assertFalse(
            shouldLoadProjectTransfers(
                projectId = "project-a",
                transfersEnabled = false
            )
        )
    }

    @Test
    fun visibleProjectTransferCountHidesEntriesWhenPermissionDenied() {
        assertEquals(
            3,
            visibleProjectTransferCount(
                scopedTransferCount = 3,
                transfersEnabled = true
            )
        )
        assertEquals(
            0,
            visibleProjectTransferCount(
                scopedTransferCount = 3,
                transfersEnabled = false
            )
        )
    }

    @Test
    fun downloadedAttachmentStaysUsableEvenWhenDownloadPermissionIsDenied() {
        assertTrue(
            canUseAttachmentPrimaryAction(
                isDownloaded = true,
                fileDownloadsAllowed = false
            )
        )
        assertFalse(
            canUseAttachmentPrimaryAction(
                isDownloaded = false,
                fileDownloadsAllowed = false
            )
        )
        assertTrue(
            canUseAttachmentPrimaryAction(
                isDownloaded = false,
                fileDownloadsAllowed = true
            )
        )
    }
}
