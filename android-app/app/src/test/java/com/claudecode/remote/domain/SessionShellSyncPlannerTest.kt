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
            maxProjects = 4
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
            maxProjects = 2
        )

        assertEquals(listOf("project-c", "project-b"), selected.map { it.projectId })
        assertTrue(selected.none { it.projectId.isBlank() })
    }

    private fun session(
        projectId: String,
        agentId: String = "agent-1",
        isAgentOnline: Boolean = true,
        isRunning: Boolean = false,
        queuedCount: Int = 0,
        lastActiveAt: Long = 0L,
        createdAt: Long = 1L
    ): Session = Session(
        id = "$agentId::$projectId",
        name = projectId,
        agentId = agentId,
        projectId = projectId,
        projectPath = "/tmp/$projectId",
        isAgentOnline = isAgentOnline,
        isRunning = isRunning,
        queuedCount = queuedCount,
        createdAt = createdAt,
        lastActiveAt = lastActiveAt
    )
}
