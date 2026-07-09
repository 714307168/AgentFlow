package com.claudecode.remote.ui.session

import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.model.MessageRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionViewModelTest {
    @Test
    fun `resolveProjectPreviewTimestamp only uses real message timestamps`() {
        assertNull(resolveProjectPreviewTimestamp(null))
        assertNull(resolveProjectPreviewTimestamp(message(timestamp = 0L)))
        assertEquals(1_700_000_000_000L, resolveProjectPreviewTimestamp(message(timestamp = 1_700_000_000_000L)))
    }

    @Test
    fun `session list sorting keeps projects without chat history below real chat previews`() {
        val sorted = listOf(
            item(title = "Synced Today", previewTimestamp = null),
            item(title = "Old Chat", previewTimestamp = 100L),
            item(title = "New Chat", previewTimestamp = 200L)
        ).sortedWith(sessionListItemComparator())

        assertEquals(listOf("New Chat", "Old Chat", "Synced Today"), sorted.map { it.title })
    }

    @Test
    fun `session list sorting still prioritizes active projects`() {
        val sorted = listOf(
            item(title = "New Chat", previewTimestamp = 200L),
            item(title = "Running Empty", previewTimestamp = null, isRunning = true),
            item(title = "Queued Empty", previewTimestamp = null, queuedCount = 1)
        ).sortedWith(sessionListItemComparator())

        assertEquals(listOf("Running Empty", "Queued Empty", "New Chat"), sorted.map { it.title })
    }

    @Test
    fun `hasStoredSessionAuth requires either token or saved credentials`() {
        assertEquals(false, hasStoredSessionAuth(token = null, hasSavedCredentials = false))
        assertEquals(false, hasStoredSessionAuth(token = "  ", hasSavedCredentials = false))
        assertEquals(true, hasStoredSessionAuth(token = "token", hasSavedCredentials = false))
        assertEquals(true, hasStoredSessionAuth(token = null, hasSavedCredentials = true))
    }

    private fun message(timestamp: Long): Message = Message(
        id = "message-$timestamp",
        projectId = "project-a",
        role = MessageRole.ASSISTANT,
        content = "hello",
        timestamp = timestamp
    )

    private fun item(
        title: String,
        previewTimestamp: Long?,
        isRunning: Boolean = false,
        queuedCount: Int = 0
    ): SessionListItem = SessionListItem(
        key = "project:$title",
        type = SessionListItemType.PROJECT,
        title = title,
        previewTimestamp = previewTimestamp,
        isRunning = isRunning,
        queuedCount = queuedCount
    )
}
