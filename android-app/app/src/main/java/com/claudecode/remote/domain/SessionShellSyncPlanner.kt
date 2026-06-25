package com.claudecode.remote.domain

import com.claudecode.remote.data.model.Session

internal const val SESSION_SHELL_SYNC_MAX_PROJECTS = 6
internal const val SESSION_SHELL_SYNC_LIMIT = 12
internal const val SESSION_SHELL_SYNC_RECENT_OVERLAP_COUNT = 3

internal fun computeSessionShellNextBackgroundCheckAfter(
    session: Session,
    nowMs: Long = System.currentTimeMillis()
): Long? {
    val intervalMs = resolveSessionShellSyncIntervalMs(resolveSessionSyncBucket(session, nowMs)) ?: return null
    return nowMs + intervalMs
}

internal fun selectSessionShellSyncTargets(
    sessions: List<Session>,
    maxProjects: Int = SESSION_SHELL_SYNC_MAX_PROJECTS,
    lastBackgroundSyncRequestedAtByProjectId: Map<String, Long> = emptyMap(),
    ignoreBackgroundSchedule: Boolean = false,
    nowMs: Long = System.currentTimeMillis()
): List<Session> {
    if (maxProjects <= 0 || sessions.isEmpty()) {
        return emptyList()
    }

    val sorted = sessions
        .asSequence()
        .mapNotNull(::normalizeSyncSession)
        .filter { session ->
            shouldScheduleSessionShellBackgroundSync(
                session = session,
                lastBackgroundSyncRequestedAtMs = lastBackgroundSyncRequestedAtByProjectId[session.projectId],
                ignoreBackgroundSchedule = ignoreBackgroundSchedule,
                nowMs = nowMs
            )
        }
        .distinctBy { session -> "${session.agentId}::${session.projectId}" }
        .sortedWith(sessionShellSyncComparator(nowMs))
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

private fun sessionShellSyncComparator(nowMs: Long): Comparator<Session> =
    compareByDescending<Session> { syncBucketPriority(resolveSessionSyncBucket(it, nowMs)) }
        .thenByDescending { it.isRunning }
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

private fun isDormantShellSyncSession(session: Session, nowMs: Long): Boolean =
    resolveSessionSyncBucket(session, nowMs) == SYNC_BUCKET_DORMANT

private fun shouldScheduleSessionShellBackgroundSync(
    session: Session,
    lastBackgroundSyncRequestedAtMs: Long?,
    ignoreBackgroundSchedule: Boolean,
    nowMs: Long
): Boolean {
    if (ignoreBackgroundSchedule) {
        return true
    }
    val intervalMs = resolveSessionShellSyncIntervalMs(resolveSessionSyncBucket(session, nowMs)) ?: return true
    val nextBackgroundCheckAfter = session.nextBackgroundCheckAfter
    if (nextBackgroundCheckAfter != null && nextBackgroundCheckAfter > nowMs) {
        return false
    }
    val lastRequestedAtMs = lastBackgroundSyncRequestedAtMs ?: return true
    if (nowMs <= lastRequestedAtMs) {
        return true
    }
    return nowMs - lastRequestedAtMs >= intervalMs
}

private fun resolveSessionShellSyncIntervalMs(bucket: String): Long? =
    when (bucket) {
        SYNC_BUCKET_COLD -> SESSION_SHELL_SYNC_COLD_INTERVAL_MS
        SYNC_BUCKET_DORMANT -> SESSION_SHELL_SYNC_DORMANT_INTERVAL_MS
        else -> null
    }

private fun resolveSessionSyncBucket(session: Session, nowMs: Long): String =
    resolveSessionSyncBucket(
        explicitBucket = session.syncBucket,
        isRunning = session.isRunning,
        queuedCount = session.queuedCount,
        lastActiveAt = session.lastActiveAt,
        createdAt = session.createdAt,
        hasProjectSignature = !session.projectSignature.isNullOrBlank(),
        hasSnapshotRevision = !session.snapshotRevision.isNullOrBlank(),
        nowMs = nowMs
    )
