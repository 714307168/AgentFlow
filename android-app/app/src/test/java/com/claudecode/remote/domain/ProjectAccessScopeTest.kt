package com.claudecode.remote.domain

import com.claudecode.remote.data.local.SessionEntity
import com.claudecode.remote.data.remote.EffectiveAgentScopeResponse
import com.claudecode.remote.data.remote.ProjectInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectAccessScopeTest {

    @Test
    fun selectedProjectScopesMergePerAgentAndPreserveOnlyAllowedProjects() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a", "project-b")
                ),
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-b", "project-c")
                )
            )
        )

        assertTrue(scope.canAccessProject("agent-1", "project-a"))
        assertTrue(scope.canAccessProject("agent-1", "project-c"))
        assertFalse(scope.canAccessProject("agent-1", "project-z"))
    }

    @Test
    fun allProjectsScopeOverridesSelectedEntriesForTheSameAgent() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a")
                ),
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "all_projects"
                )
            )
        )

        assertTrue(scope.canAccessProject("agent-1", "project-anything"))
    }

    @Test
    fun filterProjectsHonorsProjectLevelScopeWithFallbackAgentId() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a")
                )
            )
        )

        val filtered = scope.filterProjects(
            fallbackAgentId = "agent-1",
            projects = listOf(
                ProjectInfo(id = "project-a", name = "Alpha", path = "/tmp/a"),
                ProjectInfo(id = "project-b", name = "Bravo", path = "/tmp/b")
            )
        )

        assertEquals(listOf("project-a"), filtered.map { it.id })
    }

    @Test
    fun findOutOfScopeProjectIdsReturnsCachedProjectsThatShouldBeRemoved() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a")
                )
            )
        )

        val removedProjectIds = scope.findOutOfScopeProjectIds(
            listOf(
                sessionEntity(agentId = "agent-1", projectId = "project-a"),
                sessionEntity(agentId = "agent-1", projectId = "project-b"),
                sessionEntity(agentId = "agent-2", projectId = "project-c")
            )
        )

        assertEquals(setOf("project-b", "project-c"), removedProjectIds)
    }

    @Test
    fun emptyScopeFallsBackToAllowingExistingProjects() {
        val scope = ProjectAccessScope.fromAgentScopes(emptyList())

        assertTrue(scope.canAccessAgent("agent-1"))
        assertTrue(scope.canAccessProject("agent-1", "project-a"))
        assertEquals(
            listOf("project-a", "project-b"),
            scope.filterProjects(
                fallbackAgentId = "agent-1",
                projects = listOf(
                    ProjectInfo(id = "project-a", name = "Alpha", path = "/tmp/a"),
                    ProjectInfo(id = "project-b", name = "Bravo", path = "/tmp/b")
                )
            ).map { it.id }
        )
    }

    @Test
    fun explicitScopeDeniesProjectsWhenAgentIdIsMissing() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a")
                )
            )
        )

        assertFalse(scope.canAccessProject("", "project-a"))
    }

    @Test
    fun unknownAgentProjectsAreDeniedAndPrunedFromCachedSessions() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a")
                )
            )
        )

        assertFalse(scope.canAccessProject("agent-2", "project-z"))
        assertEquals(
            setOf("project-b", "project-c"),
            scope.findOutOfScopeProjectIds(
                listOf(
                    sessionEntity(agentId = "agent-1", projectId = "project-a"),
                    sessionEntity(agentId = "agent-1", projectId = "project-b"),
                    sessionEntity(agentId = "agent-2", projectId = "project-c")
                )
            )
        )
    }

    @Test
    fun explicitScopeCanDisableProjectFileDownloads() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a"),
                    allowFileDownload = false
                )
            )
        )

        assertFalse(scope.canDownloadProjectFiles("agent-1", "project-a"))
        assertFalse(scope.canDownloadProjectFiles("agent-1", "project-b"))
    }

    @Test
    fun missingCapabilityFieldsKeepProjectFileDownloadsAllowedForCompatibility() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a")
                )
            )
        )

        assertTrue(scope.canDownloadProjectFiles("agent-1", "project-a"))
    }

    @Test
    fun mergedAgentScopesUnionProjectDownloadPermission() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a"),
                    allowFileDownload = false,
                    capabilityBundle = "observe"
                ),
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a"),
                    allowFileDownload = true,
                    capabilityBundle = "collaborate"
                )
            )
        )

        assertTrue(scope.canDownloadProjectFiles("agent-1", "project-a"))
    }

    @Test
    fun explicitScopeCanDisableProjectDiagnostics() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a"),
                    allowDiagnostics = false
                )
            )
        )

        assertFalse(scope.canAccessProjectDiagnostics("agent-1", "project-a"))
        assertFalse(scope.canAccessProjectDiagnostics("agent-1", "project-b"))
    }

    @Test
    fun missingCapabilityFieldsKeepProjectDiagnosticsAllowedForCompatibility() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a")
                )
            )
        )

        assertTrue(scope.canAccessProjectDiagnostics("agent-1", "project-a"))
    }

    @Test
    fun observeBundleBlocksProjectMessagingButCollaborateAllowsIt() {
        val observeScope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a"),
                    capabilityBundle = "observe"
                )
            )
        )
        val collaborateScope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a"),
                    capabilityBundle = "collaborate"
                )
            )
        )

        assertFalse(observeScope.canSendProjectMessages("agent-1", "project-a"))
        assertTrue(collaborateScope.canSendProjectMessages("agent-1", "project-a"))
    }

    @Test
    fun missingCapabilityBundleKeepsProjectMessagingAllowedForCompatibility() {
        val scope = ProjectAccessScope.fromAgentScopes(
            listOf(
                EffectiveAgentScopeResponse(
                    agentId = "agent-1",
                    scopeType = "selected_projects",
                    projectIds = listOf("project-a")
                )
            )
        )

        assertTrue(scope.canSendProjectMessages("agent-1", "project-a"))
    }

    private fun sessionEntity(agentId: String, projectId: String): SessionEntity = SessionEntity(
        id = projectId,
        name = projectId,
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
        snapshotRevision = null,
        projectSignature = null,
        syncBucket = null,
        createdAt = 1L,
        lastActiveAt = 1L
    )
}
