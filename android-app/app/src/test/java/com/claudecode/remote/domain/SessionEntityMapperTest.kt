package com.claudecode.remote.domain

import com.claudecode.remote.data.local.SessionEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionEntityMapperTest {

    @Test
    fun `toSessionModel preserves extended sync metadata fields`() {
        val entity = SessionEntity(
            id = "agent-1::project-1",
            name = "Project 1",
            agentId = "agent-1",
            projectId = "project-1",
            projectPath = "/tmp/project-1",
            groupName = "group-a",
            cliProvider = "codex",
            cliModel = "gpt-5.4",
            isAgentOnline = true,
            isRunning = false,
            queuedCount = 2,
            currentPrompt = "Continue",
            queuePreview = "Queued prompt",
            queueJson = "[{}]",
            currentStartedAt = 123L,
            lastSyncSeq = 99L,
            activeConversationId = "conv-1",
            activeConversationTitle = "Conversation 1",
            conversationsJson = "[{}]",
            snapshotRevision = "rev-1",
            projectSignature = "sig-1",
            syncBucket = "cold",
            createdAt = 456L,
            lastActiveAt = 789L,
            nextBackgroundCheckAfter = 999L
        )

        val session = entity.toSessionModel()

        assertEquals("rev-1", session.snapshotRevision)
        assertEquals("sig-1", session.projectSignature)
        assertEquals("cold", session.syncBucket)
        assertEquals(999L, session.nextBackgroundCheckAfter)
    }
}
