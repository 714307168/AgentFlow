package com.claudecode.remote.domain

import com.claudecode.remote.data.model.Session

internal const val SESSION_SHELL_SYNC_MAX_PROJECTS = 6
internal const val SESSION_SHELL_SYNC_LIMIT = 12
internal const val SESSION_SHELL_SYNC_RECENT_OVERLAP_COUNT = 3

internal fun selectSessionShellSyncTargets(
    sessions: List<Session>,
    maxProjects: Int = SESSION_SHELL_SYNC_MAX_PROJECTS
): List<Session> {
    if (maxProjects <= 0 || sessions.isEmpty()) {
        return emptyList()
    }

    return sessions
        .asSequence()
        .mapNotNull(::normalizeSyncSession)
        .distinctBy { session -> "${session.agentId}::${session.projectId}" }
        .sortedWith(sessionShellSyncComparator())
        .take(maxProjects)
        .toList()
}

private fun normalizeSyncSession(session: Session): Session? {
    val projectId = session.projectId.trim()
    if (projectId.isEmpty()) {
        return null
    }

    return session.copy(
        agentId = session.agentId.trim(),
        projectId = projectId,
        name = session.name.trim()
    )
}

private fun sessionShellSyncComparator(): Comparator<Session> =
    compareByDescending<Session> { it.isRunning }
        .thenByDescending { it.queuedCount > 0 }
        .thenByDescending { it.queuedCount }
        .thenByDescending { it.isAgentOnline }
        .thenByDescending(::sessionActivityTimestamp)
        .thenBy { it.name.lowercase() }
        .thenBy { it.projectId }

private fun sessionActivityTimestamp(session: Session): Long =
    session.lastActiveAt.takeIf { it > 0L }
        ?: session.createdAt.takeIf { it > 0L }
        ?: 0L
