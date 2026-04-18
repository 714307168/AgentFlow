package com.claudecode.remote.domain

import com.claudecode.remote.data.remote.EffectiveAgentScopeResponse
import com.claudecode.remote.data.remote.EffectiveScopeResponse
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
}
