package com.claudecode.remote.domain

internal enum class ForegroundRecoveryStage(val wireName: String) {
    CONNECT("connect"),
    AUTH("auth"),
    CATCH_UP("catch-up"),
    STABLE("stable")
}

internal data class ForegroundRecoveryPass(
    val index: Int,
    val stage: ForegroundRecoveryStage,
    val delayMs: Long,
    val reason: String,
    val forceReconnect: Boolean
)

internal enum class ForegroundConnectionRecoveryAction {
    ENSURE_HEALTHY,
    FORCE_RECONNECT
}

internal data class ForegroundConnectionRecoveryDecision(
    val action: ForegroundConnectionRecoveryAction,
    val reason: String
)

internal fun buildForegroundRecoveryPasses(
    baseReason: String,
    delaysMs: LongArray,
    forceReconnectInitial: Boolean
): List<ForegroundRecoveryPass> = delaysMs.mapIndexed { index, delayMs ->
    val stage = when (index) {
        0 -> ForegroundRecoveryStage.CONNECT
        1 -> ForegroundRecoveryStage.AUTH
        else -> ForegroundRecoveryStage.CATCH_UP
    }
    ForegroundRecoveryPass(
        index = index,
        stage = stage,
        delayMs = delayMs,
        reason = "${baseReason}:${stage.wireName}:${delayMs}",
        forceReconnect = forceReconnectInitial && index == 0
    )
}

internal fun decideForegroundConnectionRecovery(
    pass: ForegroundRecoveryPass,
    tokenChanged: Boolean
): ForegroundConnectionRecoveryDecision {
    if (tokenChanged) {
        return ForegroundConnectionRecoveryDecision(
            action = ForegroundConnectionRecoveryAction.FORCE_RECONNECT,
            reason = "${pass.reason}-token-refresh"
        )
    }

    if (pass.forceReconnect) {
        return ForegroundConnectionRecoveryDecision(
            action = ForegroundConnectionRecoveryAction.FORCE_RECONNECT,
            reason = "${pass.reason}-force-reconnect"
        )
    }

    return ForegroundConnectionRecoveryDecision(
        action = ForegroundConnectionRecoveryAction.ENSURE_HEALTHY,
        reason = pass.reason
    )
}

internal fun shouldScheduleNetworkRecovery(
    nowMs: Long,
    lastScheduledAtMs: Long,
    minIntervalMs: Long
): Boolean {
    if (minIntervalMs <= 0L || lastScheduledAtMs <= 0L) {
        return true
    }
    return nowMs - lastScheduledAtMs >= minIntervalMs
}

internal fun shouldForceForegroundReconnect(
    nowMs: Long,
    lastStoppedAtMs: Long,
    thresholdMs: Long
): Boolean {
    if (thresholdMs <= 0L) {
        return true
    }
    if (lastStoppedAtMs <= 0L) {
        return true
    }
    return nowMs - lastStoppedAtMs >= thresholdMs
}
