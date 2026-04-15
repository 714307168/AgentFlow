package com.claudecode.remote.domain

import com.claudecode.remote.data.model.Session

internal const val SESSION_SHELL_SYNC_MAX_PROJECTS = 6
internal const val SESSION_SHELL_SYNC_LIMIT = 12
internal const val SESSION_SHELL_SYNC_RECENT_OVERLAP_COUNT = 3
internal const val SESSION_SHELL_SYNC_HOT_AGE_MS = 15L * 60L * 1000L
internal const val SESSION_SHELL_SYNC_WARM_AGE_MS = 2L * 60L * 60L * 1000L
internal const val SESSION_SHELL_SYNC_DORMANT_AGE_MS = 24L * 60L * 60L * 1000L

private const val SYNC_BUCKET_HOT = "hot"
private const val SYNC_BUCKET_WARM = "warm"
private const val SYNC_BUCKET_COLD = "cold"
private const val SYNC_BUCKET_DORMANT = "dormant"

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
    compareByDescending<Session> { syncBucketPriority(it, nowMs) }
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

private fun resolveSessionSyncBucket(session: Session, nowMs: Long): String {
    val explicitBucket = session.syncBucket?.trim()?.lowercase()
    if (
        explicitBucket == SYNC_BUCKET_HOT ||
        explicitBucket == SYNC_BUCKET_WARM ||
        explicitBucket == SYNC_BUCKET_COLD ||
        explicitBucket == SYNC_BUCKET_DORMANT
    ) {
        return explicitBucket
    }
    if (session.isRunning || session.queuedCount > 0) {
        return SYNC_BUCKET_HOT
    }
    val activityAt = sessionActivityTimestamp(session)
    if (activityAt <= 0L || nowMs <= activityAt) {
        return SYNC_BUCKET_HOT
    }
    val ageMs = nowMs - activityAt
    if (ageMs <= SESSION_SHELL_SYNC_HOT_AGE_MS) {
        return SYNC_BUCKET_HOT
    }
    if (ageMs <= SESSION_SHELL_SYNC_WARM_AGE_MS) {
        return SYNC_BUCKET_WARM
    }
    if (ageMs <= SESSION_SHELL_SYNC_DORMANT_AGE_MS) {
        return SYNC_BUCKET_COLD
    }
    return if (session.projectSignature.isNullOrBlank() || session.snapshotRevision.isNullOrBlank()) {
        SYNC_BUCKET_COLD
    } else {
        SYNC_BUCKET_DORMANT
    }
}

private fun syncBucketPriority(session: Session, nowMs: Long): Int =
    when (resolveSessionSyncBucket(session, nowMs)) {
        SYNC_BUCKET_HOT -> 3
        SYNC_BUCKET_WARM -> 2
        SYNC_BUCKET_COLD -> 1
        else -> 0
    }
