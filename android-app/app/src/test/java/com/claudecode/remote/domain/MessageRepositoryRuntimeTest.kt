package com.claudecode.remote.domain

import com.claudecode.remote.data.local.SessionEntity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageRepositoryRuntimeTest {

    @Test
    fun shouldSkipRuntimeSnapshotUpdateSkipsOnlyWhenRuntimeStateIsUnchanged() {
        val session = sessionEntity(
            snapshotRevision = "rev-1",
            projectSignature = "sig-1",
            syncBucket = "hot",
            isRunning = true,
            queuedCount = 2,
            currentPrompt = "Working",
            queuePreview = "Working",
            queueJson = "[{\"prompt\":\"Working\"}]",
            currentStartedAt = 100L,
            activeConversationId = "conv-1",
            activeConversationTitle = "Main",
            conversationsJson = "[{\"id\":\"conv-1\",\"title\":\"Main\"}]"
        )
        val runtime = runtime(
            snapshotRevision = "rev-1",
            projectSignature = "sig-1",
            syncBucket = "hot",
            isRunning = true,
            queuedCount = 2,
            currentPrompt = "Working",
            queuePreview = "Working",
            queueJson = "[{\"prompt\":\"Working\"}]",
            currentStartedAt = 100L,
            activeConversationId = "conv-1",
            activeConversationTitle = "Main",
            conversationsJson = "[{\"id\":\"conv-1\",\"title\":\"Main\"}]"
        )

        assertTrue(shouldSkipRuntimeSnapshotUpdate(session, runtime))
    }

    @Test
    fun shouldSkipRuntimeSnapshotUpdateWritesWhenRuntimeStatusFieldsDiffer() {
        val session = sessionEntity(snapshotRevision = "rev-1", projectSignature = "sig-1")
        val runtime = runtime(snapshotRevision = "rev-1", projectSignature = "sig-1", isRunning = true, queuedCount = 1)

        assertFalse(shouldSkipRuntimeSnapshotUpdate(session, runtime))
    }

    @Test
    fun shouldSkipRuntimeSnapshotUpdateWritesWhenSnapshotRevisionDiffers() {
        val session = sessionEntity(snapshotRevision = "rev-1")
        val runtime = runtime(snapshotRevision = "rev-2")

        assertFalse(shouldSkipRuntimeSnapshotUpdate(session, runtime))
    }

    @Test
    fun resolveSessionSyncConversationIdUsesRuntimeConversationWhenPresent() {
        val runtime = runtime(
            snapshotRevision = "rev-1",
            activeConversationId = " conv-runtime "
        )

        val conversationId = resolveSessionSyncConversationId(
            runtime = runtime,
            cachedActiveConversationId = "conv-cached"
        )

        org.junit.Assert.assertEquals("conv-runtime", conversationId)
    }

    @Test
    fun resolveSessionSyncConversationIdFallsBackToCachedActiveConversation() {
        val conversationId = resolveSessionSyncConversationId(
            runtime = null,
            cachedActiveConversationId = " conv-cached "
        )

        org.junit.Assert.assertEquals("conv-cached", conversationId)
    }

    @Test
    fun resolveSessionSyncConversationIdAllowsConversationlessProjects() {
        val conversationId = resolveSessionSyncConversationId(
            runtime = null,
            cachedActiveConversationId = "  "
        )

        org.junit.Assert.assertNull(conversationId)
    }

    private fun runtime(
        snapshotRevision: String?,
        projectSignature: String? = null,
        syncBucket: String? = null,
        isRunning: Boolean = false,
        queuedCount: Int = 0,
        currentPrompt: String? = null,
        queuePreview: String? = null,
        queueJson: String? = null,
        currentStartedAt: Long? = null,
        activeConversationId: String? = null,
        activeConversationTitle: String? = null,
        conversationsJson: String? = null
    ): IncomingSessionRuntime = IncomingSessionRuntime(
        provider = "claude",
        model = "sonnet",
        isRunning = isRunning,
        queuedCount = queuedCount,
        currentPrompt = currentPrompt,
        queuePreview = queuePreview,
        queueJson = queueJson,
        currentStartedAt = currentStartedAt,
        activeConversationId = activeConversationId,
        activeConversationTitle = activeConversationTitle,
        conversationsJson = conversationsJson,
        snapshotRevision = snapshotRevision,
        projectSignature = projectSignature,
        syncBucket = syncBucket
    )

    private fun sessionEntity(
        snapshotRevision: String?,
        projectSignature: String? = null,
        syncBucket: String? = null,
        isRunning: Boolean = false,
        queuedCount: Int = 0,
        currentPrompt: String? = null,
        queuePreview: String? = null,
        queueJson: String? = null,
        currentStartedAt: Long? = null,
        activeConversationId: String? = null,
        activeConversationTitle: String? = null,
        conversationsJson: String? = null
    ): SessionEntity = SessionEntity(
        id = "agent-1::project-1",
        name = "project-1",
        agentId = "agent-1",
        projectId = "project-1",
        projectPath = "/tmp/project-1",
        cliProvider = "claude",
        cliModel = "sonnet",
        isAgentOnline = true,
        isRunning = isRunning,
        queuedCount = queuedCount,
        currentPrompt = currentPrompt,
        queuePreview = queuePreview,
        queueJson = queueJson,
        currentStartedAt = currentStartedAt,
        lastSyncSeq = 0L,
        activeConversationId = activeConversationId,
        activeConversationTitle = activeConversationTitle,
        conversationsJson = conversationsJson,
        snapshotRevision = snapshotRevision,
        projectSignature = projectSignature,
        syncBucket = syncBucket,
        createdAt = 1L,
        lastActiveAt = 1L
    )
}
