package com.claudecode.remote.domain

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
