package com.claudecode.remote.domain

import com.claudecode.remote.data.local.SessionEntity
import com.claudecode.remote.data.remote.ProjectInfo
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

    @Test
    fun `buildRemovedProjectIdsForReplacement removes missing projects on full replace`() {
        val removedProjectIds = buildRemovedProjectIdsForReplacement(
            existingSessions = listOf(
                sessionEntity(projectId = "project-a", agentId = "agent-1"),
                sessionEntity(projectId = "project-b", agentId = "agent-2"),
                sessionEntity(projectId = "project-c", agentId = "agent-2"),
            ),
            nextProjects = listOf(
                projectInfo(projectId = "project-a"),
                projectInfo(projectId = "project-c")
            ),
            agentId = "agent-1",
            fullReplace = true
        )

        assertEquals(setOf("project-b"), removedProjectIds)
    }

    @Test
    fun `buildRemovedProjectIdsForReplacement only removes projects under the updated agent on partial replace`() {
        val removedProjectIds = buildRemovedProjectIdsForReplacement(
            existingSessions = listOf(
                sessionEntity(projectId = "project-a", agentId = "agent-1"),
                sessionEntity(projectId = "project-b", agentId = "agent-1"),
                sessionEntity(projectId = "project-c", agentId = "agent-2"),
            ),
            nextProjects = listOf(
                projectInfo(projectId = "project-a")
            ),
            agentId = "agent-1",
            fullReplace = false
        )

        assertEquals(setOf("project-b"), removedProjectIds)
    }

    @Test
    fun `buildRemovedProjectIdsForDelta trims dedupes and skips projects that are re-upserted`() {
        val removedProjectIds = buildRemovedProjectIdsForDelta(
            projectRemoves = listOf("project-a", " project-b ", "project-a", "", "project-c"),
            retainedProjectIds = listOf("project-b")
        )

        assertEquals(listOf("project-a", "project-c"), removedProjectIds)
    }

    @Test
    fun `shouldTrustEmptyFullProjectReplacement trusts explicit empty server state`() {
        assertEquals(
            true,
            shouldTrustEmptyFullProjectReplacement(
                projectCount = 0,
                revision = "sync-empty:agent-1",
                hasExplicitProjectAccessScope = false
            )
        )
    }

    @Test
    fun `shouldTrustEmptyFullProjectReplacement trusts empty explicit access scope`() {
        assertEquals(
            true,
            shouldTrustEmptyFullProjectReplacement(
                projectCount = 3,
                revision = "rev-1",
                hasExplicitProjectAccessScope = true
            )
        )
    }

    @Test
    fun `shouldTrustEmptyFullProjectReplacement keeps legacy empty response protective`() {
        assertEquals(
            false,
            shouldTrustEmptyFullProjectReplacement(
                projectCount = null,
                revision = null,
                hasExplicitProjectAccessScope = false
            )
        )
    }

    private fun sessionEntity(
        projectId: String,
        agentId: String = "agent-1",
        syncBucket: String? = null,
    ): SessionEntity = SessionEntity(
        id = projectId.ifBlank { "blank" },
        name = projectId.ifBlank { "blank" },
        agentId = agentId,
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

    private fun projectInfo(projectId: String): ProjectInfo = ProjectInfo(
        id = projectId,
        name = projectId,
        path = "/tmp/$projectId",
        agentId = "",
        cliProvider = "claude",
        cliModel = null,
        online = true
    )
}
