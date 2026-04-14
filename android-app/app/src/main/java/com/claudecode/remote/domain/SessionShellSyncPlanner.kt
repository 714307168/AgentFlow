package com.claudecode.remote.domain

import com.claudecode.remote.data.model.Session

internal const val SESSION_SHELL_SYNC_MAX_PROJECTS = 6
internal const val SESSION_SHELL_SYNC_LIMIT = 12
internal const val SESSION_SHELL_SYNC_RECENT_OVERLAP_COUNT = 3
internal const val SESSION_SHELL_SYNC_DORMANT_AGE_MS = 24L * 60L * 60L * 1000L

internal fun selectSessionShellSyncTargets(
    sessions: List<Session>,
    maxProjects: Int = SESSION_SHELL_SYNC_MAX_PROJECTS,
    nowMs: Long = System.currentTimeMillis()
): List<Session> {
    if (maxProjects <= 0 || sessions.isEmpty()) {
        return emptyList()
    }

    val sorted = sessions
        .asSequence()
        .mapNotNull(::normalizeSyncSession)
        .distinctBy { session -> "${session.agentId}::${session.projectId}" }
        .sortedWith(sessionShellSyncComparator())
        .toList()

    val activeSessions = sorted.filterNot { isDormantShellSyncSession(it, nowMs) }
    if (activeSessions.size >= maxProjects) {
        return activeSessions.take(maxProjects)
    }

    val dormantSessions = sorted.filter { isDormantShellSyncSession(it, nowMs) }
    return buildList(maxProjects) {
        addAll(activeSessions.take(maxProjects))
        if (size < maxProjects) {
            addAll(dormantSessions.take(maxProjects - size))
        }
    }
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

private fun isDormantShellSyncSession(session: Session, nowMs: Long): Boolean {
    if (session.isRunning || session.queuedCount > 0) {
        return false
    }
    if (session.projectSignature.isNullOrBlank() || session.snapshotRevision.isNullOrBlank()) {
        return false
    }
    val activityAt = sessionActivityTimestamp(session)
    if (activityAt <= 0L || nowMs <= activityAt) {
        return false
    }
    return nowMs - activityAt >= SESSION_SHELL_SYNC_DORMANT_AGE_MS
}
