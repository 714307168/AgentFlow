package com.claudecode.remote.domain

import com.claudecode.remote.data.model.Session
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionShellSyncPlannerTest {

    @Test
    fun `selectSessionShellSyncTargets prioritizes running queued and recent sessions`() {
        val selected = selectSessionShellSyncTargets(
            sessions = listOf(
                session(projectId = "recent-online", lastActiveAt = 400L),
                session(projectId = "running", isRunning = true, lastActiveAt = 100L),
                session(projectId = "queued", queuedCount = 2, lastActiveAt = 200L),
                session(projectId = "older-online", lastActiveAt = 50L),
                session(projectId = "offline-newer", isAgentOnline = false, lastActiveAt = 500L),
            ),
            maxProjects = 4,
            nowMs = 1_000L
        )

        assertEquals(
            listOf("running", "queued", "recent-online", "older-online"),
            selected.map { it.projectId }
        )
    }

    @Test
    fun `selectSessionShellSyncTargets trims blanks dedupes and respects maxProjects`() {
        val selected = selectSessionShellSyncTargets(
            sessions = listOf(
                session(projectId = "project-a", agentId = "agent-1", lastActiveAt = 10L),
                session(projectId = "project-a", agentId = "agent-1", lastActiveAt = 20L),
                session(projectId = "project-b", agentId = "agent-1", lastActiveAt = 30L),
                session(projectId = " ", agentId = "agent-2", lastActiveAt = 40L),
                session(projectId = "project-c", agentId = "agent-2", lastActiveAt = 50L),
            ),
            maxProjects = 2,
            nowMs = 1_000L
        )

        assertEquals(listOf("project-c", "project-b"), selected.map { it.projectId })
        assertTrue(selected.none { it.projectId.isBlank() })
    }

    @Test
    fun `selectSessionShellSyncTargets skips dormant signed sessions when active targets are available`() {
        val nowMs = 3 * SESSION_SHELL_SYNC_DORMANT_AGE_MS
        val selected = selectSessionShellSyncTargets(
            sessions = listOf(
                session(projectId = "running", isRunning = true, lastActiveAt = nowMs - 100L),
                session(projectId = "recent", lastActiveAt = nowMs - 1_000L),
                session(
                    projectId = "dormant-a",
                    lastActiveAt = nowMs - SESSION_SHELL_SYNC_DORMANT_AGE_MS - 5_000L,
                    snapshotRevision = "rev-a",
                    projectSignature = "sig-a"
                ),
                session(
                    projectId = "dormant-b",
                    lastActiveAt = nowMs - SESSION_SHELL_SYNC_DORMANT_AGE_MS - 10_000L,
                    snapshotRevision = "rev-b",
                    projectSignature = "sig-b"
                ),
            ),
            maxProjects = 2,
            nowMs = nowMs
        )

        assertEquals(listOf("running", "recent"), selected.map { it.projectId })
    }

    @Test
    fun `selectSessionShellSyncTargets honors explicit sync buckets from the runtime shell`() {
        val nowMs = 3 * SESSION_SHELL_SYNC_DORMANT_AGE_MS
        val selected = selectSessionShellSyncTargets(
            sessions = listOf(
                session(projectId = "warm-project", syncBucket = "warm", lastActiveAt = nowMs - 5_000L),
                session(projectId = "dormant-project", syncBucket = "dormant", lastActiveAt = nowMs - 1_000L),
                session(projectId = "hot-project", syncBucket = "hot", lastActiveAt = nowMs - 10_000L),
                session(projectId = "cold-project", syncBucket = "cold", lastActiveAt = nowMs - 20_000L),
            ),
            maxProjects = 3,
            nowMs = nowMs
        )

        assertEquals(listOf("hot-project", "warm-project", "cold-project"), selected.map { it.projectId })
    }

    @Test
    fun `selectSessionShellSyncTargets skips cold projects until the background ttl expires`() {
        val nowMs = 3 * SESSION_SHELL_SYNC_DORMANT_AGE_MS
        val selected = selectSessionShellSyncTargets(
            sessions = listOf(
                session(projectId = "hot-project", isRunning = true, lastActiveAt = nowMs - 100L),
                session(projectId = "cold-project", syncBucket = "cold", lastActiveAt = nowMs - 5_000L),
            ),
            maxProjects = 2,
            lastBackgroundSyncRequestedAtByProjectId = mapOf(
                "cold-project" to (nowMs - SESSION_SHELL_SYNC_COLD_INTERVAL_MS + 5_000L)
            ),
            nowMs = nowMs
        )

        assertEquals(listOf("hot-project"), selected.map { it.projectId })
    }

    @Test
    fun `selectSessionShellSyncTargets re-enables dormant projects once their ttl expires`() {
        val nowMs = 3 * SESSION_SHELL_SYNC_DORMANT_AGE_MS
        val selected = selectSessionShellSyncTargets(
            sessions = listOf(
                session(projectId = "dormant-project", syncBucket = "dormant", lastActiveAt = nowMs - 5_000L),
            ),
            maxProjects = 1,
            lastBackgroundSyncRequestedAtByProjectId = mapOf(
                "dormant-project" to (nowMs - SESSION_SHELL_SYNC_DORMANT_INTERVAL_MS - 1L)
            ),
            nowMs = nowMs
        )

        assertEquals(listOf("dormant-project"), selected.map { it.projectId })
    }

    private fun session(
        projectId: String,
        agentId: String = "agent-1",
        isAgentOnline: Boolean = true,
        isRunning: Boolean = false,
        queuedCount: Int = 0,
        lastActiveAt: Long = 0L,
        createdAt: Long = 1L,
        snapshotRevision: String? = null,
        projectSignature: String? = null,
        syncBucket: String? = null
    ): Session = Session(
        id = "$agentId::$projectId",
        name = projectId,
        agentId = agentId,
        projectId = projectId,
        projectPath = "/tmp/$projectId",
        isAgentOnline = isAgentOnline,
        isRunning = isRunning,
        queuedCount = queuedCount,
        snapshotRevision = snapshotRevision,
        projectSignature = projectSignature,
        syncBucket = syncBucket,
        createdAt = createdAt,
        lastActiveAt = lastActiveAt
    )
}
