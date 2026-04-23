package com.claudecode.remote.domain

import com.claudecode.remote.data.remote.EffectiveAgentScopeResponse
import com.claudecode.remote.data.remote.EffectiveScopeResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectAccessGuardTest {

    @Test
    fun routeGuardAllowsProjectWhenNoCachedScopeExists() {
        assertFalse(
            isProjectRouteBlockedByCachedScope(
                effectiveScopeJson = null,
                agentId = "agent-1",
                projectId = "project-a"
            )
        )
    }

    @Test
    fun routeGuardBlocksProjectWhenCachedScopeNoLongerAllowsIt() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(
                agentScopes = listOf(
                    EffectiveAgentScopeResponse(
                        agentId = "agent-1",
                        scopeType = "selected_projects",
                        projectIds = listOf("project-a")
                    )
                )
            )
        )

        assertTrue(
            isProjectRouteBlockedByCachedScope(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-1",
                projectId = "project-b"
            )
        )
        assertEquals(
            ProjectRouteAccessState(
                isBlocked = true,
                noticeKind = ProjectAccessNoticeKind.ROUTE_BLOCKED_BY_SCOPE
            ),
            resolveProjectRouteAccessState(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-1",
                projectId = "project-b"
            )
        )
    }

    @Test
    fun routeGuardAllowsProjectWhenCachedScopeStillIncludesIt() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(
                agentScopes = listOf(
                    EffectiveAgentScopeResponse(
                        agentId = "agent-1",
                        scopeType = "selected_projects",
                        projectIds = listOf("project-a", "project-b")
                    )
                )
            )
        )

        assertFalse(
            isProjectRouteBlockedByCachedScope(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-1",
                projectId = "project-b"
            )
        )
    }

    @Test
    fun routeGuardAllowsProjectWhenCachedScopeHasNoAgentEntries() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(agentScopes = emptyList())
        )

        assertFalse(
            isProjectRouteBlockedByCachedScope(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-1",
                projectId = "project-b"
            )
        )
    }

    @Test
    fun routeGuardBlocksProjectWhenAgentIsMissingFromCachedScope() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(
                agentScopes = listOf(
                    EffectiveAgentScopeResponse(
                        agentId = "agent-1",
                        scopeType = "selected_projects",
                        projectIds = listOf("project-a")
                    )
                )
            )
        )

        assertTrue(
            isProjectRouteBlockedByCachedScope(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-2",
                projectId = "project-b"
            )
        )
    }

    @Test
    fun routeGuardBlocksProjectWhenAgentIdIsBlankUnderExplicitScope() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(
                agentScopes = listOf(
                    EffectiveAgentScopeResponse(
                        agentId = "agent-1",
                        scopeType = "selected_projects",
                        projectIds = listOf("project-a")
                    )
                )
            )
        )

        assertTrue(
            isProjectRouteBlockedByCachedScope(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "",
                projectId = "project-a"
            )
        )
    }

    @Test
    fun sessionRevocationStaysFalseWhileAccessibleSessionStillExists() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(
                agentScopes = listOf(
                    EffectiveAgentScopeResponse(
                        agentId = "agent-1",
                        scopeType = "selected_projects",
                        projectIds = listOf("project-a")
                    )
                )
            )
        )

        assertFalse(
            isProjectSessionRevokedByCachedScope(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-1",
                projectId = "project-a",
                hasAccessibleSession = true
            )
        )
    }

    @Test
    fun sessionRevocationTurnsTrueWhenAccessibleSessionDisappearsOutsideScope() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(
                agentScopes = listOf(
                    EffectiveAgentScopeResponse(
                        agentId = "agent-1",
                        scopeType = "selected_projects",
                        projectIds = listOf("project-a")
                    )
                )
            )
        )

        assertTrue(
            isProjectSessionRevokedByCachedScope(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-1",
                projectId = "project-b",
                hasAccessibleSession = false
            )
        )
    }

    @Test
    fun accessStateRequestsLocalCacheClearOnFirstRevokedTransition() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(
                agentScopes = listOf(
                    EffectiveAgentScopeResponse(
                        agentId = "agent-1",
                        scopeType = "selected_projects",
                        projectIds = listOf("project-a")
                    )
                )
            )
        )

        assertEquals(
            ProjectSessionAccessState(
                projectAccessRevoked = true,
                shouldClearLocalCache = true,
                noticeKind = ProjectAccessNoticeKind.SESSION_REVOKED_BY_SCOPE
            ),
            resolveProjectSessionAccessState(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-1",
                projectId = "project-b",
                hasAccessibleSession = false,
                wasAlreadyRevoked = false
            )
        )
    }

    @Test
    fun accessStateDoesNotRequestRepeatedCacheClearAfterRevokedStateIsLatched() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(
                agentScopes = listOf(
                    EffectiveAgentScopeResponse(
                        agentId = "agent-1",
                        scopeType = "selected_projects",
                        projectIds = listOf("project-a")
                    )
                )
            )
        )

        assertEquals(
            ProjectSessionAccessState(
                projectAccessRevoked = true,
                shouldClearLocalCache = false,
                noticeKind = ProjectAccessNoticeKind.SESSION_REVOKED_BY_SCOPE
            ),
            resolveProjectSessionAccessState(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-1",
                projectId = "project-b",
                hasAccessibleSession = false,
                wasAlreadyRevoked = true
            )
        )
    }

    @Test
    fun cachedScopeFileDownloadGuardHonorsExplicitDisabledFlag() {
        val effectiveScopeJson = ProjectAccessScopeCodec.encode(
            EffectiveScopeResponse(
                agentScopes = listOf(
                    EffectiveAgentScopeResponse(
                        agentId = "agent-1",
                        scopeType = "selected_projects",
                        projectIds = listOf("project-a"),
                        allowFileDownload = false
                    )
                )
            )
        )

        assertFalse(
            isProjectFileDownloadAllowedByCachedScope(
                effectiveScopeJson = effectiveScopeJson,
                agentId = "agent-1",
                projectId = "project-a"
            )
        )
    }

    @Test
    fun cachedScopeFileDownloadGuardFallsBackToAllowedWhenScopeUnavailable() {
        assertTrue(
            isProjectFileDownloadAllowedByCachedScope(
                effectiveScopeJson = null,
                agentId = "agent-1",
                projectId = "project-a"
            )
        )
    }
}
