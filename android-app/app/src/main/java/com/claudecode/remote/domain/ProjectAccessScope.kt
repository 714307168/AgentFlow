package com.claudecode.remote.domain

import com.claudecode.remote.data.local.SessionEntity
import com.claudecode.remote.data.remote.EffectiveAgentScopeResponse
import com.claudecode.remote.data.remote.EffectiveScopeResponse
import com.claudecode.remote.data.remote.ProjectInfo
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

internal data class AgentProjectAccessScope(
    val agentId: String,
    val ownerUserId: Int,
    val ownerUsername: String,
    val isOwned: Boolean,
    val scopeType: String,
    val projectIds: Set<String>
)

internal class ProjectAccessScope private constructor(
    private val scopesByAgentId: Map<String, AgentProjectAccessScope>
) {
    private val hasExplicitAgentScopes = scopesByAgentId.isNotEmpty()

    fun canAccessAgent(agentId: String): Boolean =
        !hasExplicitAgentScopes || scopesByAgentId.containsKey(agentId.trim())

    fun canAccessProject(agentId: String, projectId: String): Boolean {
        val normalizedAgentId = agentId.trim()
        val normalizedProjectId = projectId.trim()
        if (normalizedProjectId.isEmpty()) {
            return false
        }
        if (!hasExplicitAgentScopes) {
            return true
        }
        if (normalizedAgentId.isEmpty()) {
            return true
        }
        val scope = scopesByAgentId[normalizedAgentId] ?: return true
        return scope.scopeType == SCOPE_TYPE_ALL_PROJECTS || normalizedProjectId in scope.projectIds
    }

    fun filterProjects(
        fallbackAgentId: String,
        projects: Collection<ProjectInfo>
    ): List<ProjectInfo> =
        projects.mapNotNull { project ->
            val normalizedProjectId = project.id.trim()
            val resolvedAgentId = project.agentId.trim().ifBlank { fallbackAgentId.trim() }
            if (!canAccessProject(resolvedAgentId, normalizedProjectId)) {
                return@mapNotNull null
            }
            project.copy(
                id = normalizedProjectId,
                agentId = project.agentId.ifBlank { resolvedAgentId }
            )
        }

    fun findOutOfScopeProjectIds(sessions: Collection<SessionEntity>): Set<String> =
        sessions.mapNotNullTo(linkedSetOf()) { session ->
            val normalizedProjectId = session.projectId.trim()
            val normalizedAgentId = session.agentId.trim()
            if (canAccessProject(normalizedAgentId, normalizedProjectId)) {
                null
            } else {
                normalizedProjectId.takeIf { it.isNotEmpty() }
            }
        }

    companion object {
        private const val SCOPE_TYPE_ALL_PROJECTS = "all_projects"
        private const val SCOPE_TYPE_SELECTED_PROJECTS = "selected_projects"

        fun fromResponse(response: EffectiveScopeResponse): ProjectAccessScope =
            fromAgentScopes(response.agentScopes)

        fun fromAgentScopes(agentScopes: Collection<EffectiveAgentScopeResponse>): ProjectAccessScope {
            val merged = linkedMapOf<String, AgentProjectAccessScope>()
            agentScopes.forEach { scope ->
                val normalizedAgentId = scope.agentId.trim()
                if (normalizedAgentId.isEmpty()) {
                    return@forEach
                }
                val normalizedProjectIds = scope.projectIds
                    .asSequence()
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }
                    .toSet()
                val isAllProjects = scope.isOwned || scope.scopeType.trim().lowercase() == SCOPE_TYPE_ALL_PROJECTS
                val previous = merged[normalizedAgentId]
                merged[normalizedAgentId] = if (previous == null) {
                    AgentProjectAccessScope(
                        agentId = normalizedAgentId,
                        ownerUserId = scope.ownerUserId,
                        ownerUsername = scope.ownerUsername.trim(),
                        isOwned = scope.isOwned,
                        scopeType = if (isAllProjects) SCOPE_TYPE_ALL_PROJECTS else SCOPE_TYPE_SELECTED_PROJECTS,
                        projectIds = if (isAllProjects) emptySet() else normalizedProjectIds
                    )
                } else {
                    val mergedAllProjects = previous.scopeType == SCOPE_TYPE_ALL_PROJECTS || isAllProjects
                    previous.copy(
                        ownerUserId = if (previous.ownerUserId != 0) previous.ownerUserId else scope.ownerUserId,
                        ownerUsername = previous.ownerUsername.ifBlank { scope.ownerUsername.trim() },
                        isOwned = previous.isOwned || scope.isOwned,
                        scopeType = if (mergedAllProjects) SCOPE_TYPE_ALL_PROJECTS else SCOPE_TYPE_SELECTED_PROJECTS,
                        projectIds = if (mergedAllProjects) emptySet() else previous.projectIds + normalizedProjectIds
                    )
                }
            }
            return ProjectAccessScope(merged.toMap())
        }
    }
}

internal object ProjectAccessScopeCodec {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun encode(response: EffectiveScopeResponse): String =
        json.encodeToString(response)

    fun decode(rawJson: String?): EffectiveScopeResponse? {
        val normalized = rawJson?.trim().orEmpty()
        if (normalized.isEmpty()) {
            return null
        }
        return runCatching {
            json.decodeFromString<EffectiveScopeResponse>(normalized)
        }.getOrNull()
    }
}
