package com.claudecode.remote.domain

internal data class ProjectSessionAccessState(
    val projectAccessRevoked: Boolean,
    val shouldClearLocalCache: Boolean
)

internal fun isProjectRouteBlockedByCachedScope(
    effectiveScopeJson: String?,
    agentId: String,
    projectId: String
): Boolean {
    val normalizedProjectId = projectId.trim()
    if (normalizedProjectId.isEmpty()) {
        return false
    }
    val response = ProjectAccessScopeCodec.decode(effectiveScopeJson) ?: return false
    val scope = ProjectAccessScope.fromResponse(response)
    return !scope.canAccessProject(agentId = agentId, projectId = normalizedProjectId)
}

internal fun isProjectSessionRevokedByCachedScope(
    effectiveScopeJson: String?,
    agentId: String,
    projectId: String,
    hasAccessibleSession: Boolean
): Boolean {
    if (hasAccessibleSession) {
        return false
    }
    return isProjectRouteBlockedByCachedScope(
        effectiveScopeJson = effectiveScopeJson,
        agentId = agentId,
        projectId = projectId
    )
}

internal fun resolveProjectSessionAccessState(
    effectiveScopeJson: String?,
    agentId: String,
    projectId: String,
    hasAccessibleSession: Boolean,
    wasAlreadyRevoked: Boolean
): ProjectSessionAccessState {
    val projectAccessRevoked = isProjectSessionRevokedByCachedScope(
        effectiveScopeJson = effectiveScopeJson,
        agentId = agentId,
        projectId = projectId,
        hasAccessibleSession = hasAccessibleSession
    )
    return ProjectSessionAccessState(
        projectAccessRevoked = projectAccessRevoked,
        shouldClearLocalCache = projectAccessRevoked && !wasAlreadyRevoked
    )
}
