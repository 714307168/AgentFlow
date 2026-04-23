package com.claudecode.remote.domain

enum class ProjectAccessNoticeKind {
    ROUTE_BLOCKED_BY_SCOPE,
    SESSION_REVOKED_BY_SCOPE
}

internal data class ProjectRouteAccessState(
    val isBlocked: Boolean,
    val noticeKind: ProjectAccessNoticeKind? = null
)

internal data class ProjectSessionAccessState(
    val projectAccessRevoked: Boolean,
    val shouldClearLocalCache: Boolean,
    val noticeKind: ProjectAccessNoticeKind? = null
)

internal fun isProjectRouteBlockedByCachedScope(
    effectiveScopeJson: String?,
    agentId: String,
    projectId: String
): Boolean =
    resolveProjectRouteAccessState(
        effectiveScopeJson = effectiveScopeJson,
        agentId = agentId,
        projectId = projectId
    ).isBlocked

internal fun resolveProjectRouteAccessState(
    effectiveScopeJson: String?,
    agentId: String,
    projectId: String
): ProjectRouteAccessState {
    val normalizedProjectId = projectId.trim()
    if (normalizedProjectId.isEmpty()) {
        return ProjectRouteAccessState(isBlocked = false)
    }
    val response = ProjectAccessScopeCodec.decode(effectiveScopeJson)
        ?: return ProjectRouteAccessState(isBlocked = false)
    val scope = ProjectAccessScope.fromResponse(response)
    val isBlocked = !scope.canAccessProject(agentId = agentId, projectId = normalizedProjectId)
    return ProjectRouteAccessState(
        isBlocked = isBlocked,
        noticeKind = if (isBlocked) ProjectAccessNoticeKind.ROUTE_BLOCKED_BY_SCOPE else null
    )
}

internal fun isProjectFileDownloadAllowedByCachedScope(
    effectiveScopeJson: String?,
    agentId: String,
    projectId: String
): Boolean {
    val normalizedProjectId = projectId.trim()
    if (normalizedProjectId.isEmpty()) {
        return false
    }
    val response = ProjectAccessScopeCodec.decode(effectiveScopeJson) ?: return true
    val scope = ProjectAccessScope.fromResponse(response)
    return scope.canDownloadProjectFiles(agentId = agentId, projectId = normalizedProjectId)
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
        shouldClearLocalCache = projectAccessRevoked && !wasAlreadyRevoked,
        noticeKind = if (projectAccessRevoked) ProjectAccessNoticeKind.SESSION_REVOKED_BY_SCOPE else null
    )
}
