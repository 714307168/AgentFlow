package com.claudecode.remote.domain

import com.claudecode.remote.data.local.SessionEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionSyncDeltaTest {

    @Test
    fun `buildKnownProjectsForDelta only keeps hot and warm project signatures`() {
        val nowMs = 3 * SESSION_SHELL_SYNC_DORMANT_AGE_MS
        val knownProjects = buildKnownProjectsForDelta(
            listOf(
                sessionEntity(projectId = "hot-project", syncBucket = "hot"),
                sessionEntity(projectId = "warm-project", syncBucket = "warm"),
                sessionEntity(projectId = "cold-project", syncBucket = "cold"),
                sessionEntity(projectId = "dormant-project", syncBucket = "dormant"),
            ),
            nowMs = nowMs
        )

        assertEquals(listOf("hot-project", "warm-project"), knownProjects.map { it.projectId })
    }

    @Test
    fun `buildKnownProjectIdsForDelta keeps all distinct known project ids`() {
        val knownProjectIds = buildKnownProjectIdsForDelta(
            listOf(
                sessionEntity(projectId = "project-b"),
                sessionEntity(projectId = "project-a"),
                sessionEntity(projectId = "project-b"),
                sessionEntity(projectId = " "),
            )
        )

        assertEquals(listOf("project-a", "project-b"), knownProjectIds)
    }

    private fun sessionEntity(
        projectId: String,
        syncBucket: String? = null,
    ): SessionEntity = SessionEntity(
        id = projectId.ifBlank { "blank" },
        name = projectId.ifBlank { "blank" },
        agentId = "agent-1",
        projectId = projectId,
        projectPath = "/tmp/$projectId",
        cliProvider = "claude",
        cliModel = null,
        isAgentOnline = true,
        isRunning = false,
        queuedCount = 0,
        currentPrompt = null,
        queuePreview = null,
        queueJson = null,
        currentStartedAt = null,
        lastSyncSeq = 0L,
        activeConversationId = null,
        activeConversationTitle = null,
        conversationsJson = null,
        snapshotRevision = "rev-1",
        projectSignature = "sig-1",
        syncBucket = syncBucket,
        createdAt = 1L,
        lastActiveAt = 1L
    )
}
