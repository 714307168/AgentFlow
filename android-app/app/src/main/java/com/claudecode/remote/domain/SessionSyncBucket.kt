package com.claudecode.remote.domain

internal const val SESSION_SHELL_SYNC_HOT_AGE_MS = 15L * 60L * 1000L
internal const val SESSION_SHELL_SYNC_WARM_AGE_MS = 2L * 60L * 60L * 1000L
internal const val SESSION_SHELL_SYNC_DORMANT_AGE_MS = 24L * 60L * 60L * 1000L

internal const val SYNC_BUCKET_HOT = "hot"
internal const val SYNC_BUCKET_WARM = "warm"
internal const val SYNC_BUCKET_COLD = "cold"
internal const val SYNC_BUCKET_DORMANT = "dormant"

internal fun normalizeSyncBucket(bucket: String?): String? =
    when (bucket?.trim()?.lowercase()) {
        SYNC_BUCKET_HOT -> SYNC_BUCKET_HOT
        SYNC_BUCKET_WARM -> SYNC_BUCKET_WARM
        SYNC_BUCKET_COLD -> SYNC_BUCKET_COLD
        SYNC_BUCKET_DORMANT -> SYNC_BUCKET_DORMANT
        else -> null
    }

internal fun resolveSessionSyncBucket(
    explicitBucket: String?,
    isRunning: Boolean,
    queuedCount: Int,
    lastActiveAt: Long,
    createdAt: Long,
    hasProjectSignature: Boolean,
    hasSnapshotRevision: Boolean,
    nowMs: Long = System.currentTimeMillis()
): String {
    normalizeSyncBucket(explicitBucket)?.let { return it }
    if (isRunning || queuedCount > 0) {
        return SYNC_BUCKET_HOT
    }
    val activityAt = lastActiveAt.takeIf { it > 0L }
        ?: createdAt.takeIf { it > 0L }
        ?: 0L
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
    return if (hasProjectSignature && hasSnapshotRevision) {
        SYNC_BUCKET_DORMANT
    } else {
        SYNC_BUCKET_COLD
    }
}

internal fun syncBucketPriority(bucket: String): Int =
    when (bucket) {
        SYNC_BUCKET_HOT -> 3
        SYNC_BUCKET_WARM -> 2
        SYNC_BUCKET_COLD -> 1
        else -> 0
    }

internal fun shouldSendProjectSignatureForDelta(bucket: String): Boolean =
    bucket == SYNC_BUCKET_HOT || bucket == SYNC_BUCKET_WARM
