package com.claudecode.remote.domain

internal fun isProjectRouteBlockedByCachedScope(
    effectiveScopeJson: String?,
    agentId: String,
    projectId: String
): Boolean {
    val normalizedAgentId = agentId.trim()
    val normalizedProjectId = projectId.trim()
    if (normalizedAgentId.isEmpty() || normalizedProjectId.isEmpty()) {
        return false
    }
    val response = ProjectAccessScopeCodec.decode(effectiveScopeJson) ?: return false
    val scope = ProjectAccessScope.fromResponse(response)
    return !scope.canAccessProject(normalizedAgentId, normalizedProjectId)
}
