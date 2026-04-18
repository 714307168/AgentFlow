package com.claudecode.remote.domain

internal enum class AuthenticatedRelayFollowUpStage(val wireName: String) {
    CATALOG("catalog"),
    CATCH_UP("catch-up"),
    STABILIZE("stabilize")
}

internal data class AuthenticatedRelayFollowUpPass(
    val stage: AuthenticatedRelayFollowUpStage,
    val delayMs: Long,
    val reason: String,
    val forceSessionSync: Boolean,
    val requestSessionShellSync: Boolean,
    val forceWorkgroupRefresh: Boolean
)

internal fun buildAuthenticatedRelayFollowUpPasses(
    baseReason: String,
    delaysMs: LongArray,
    includeImmediateCatalogPass: Boolean = true
): List<AuthenticatedRelayFollowUpPass> {
    val passes = mutableListOf<AuthenticatedRelayFollowUpPass>()
    if (includeImmediateCatalogPass) {
        passes += AuthenticatedRelayFollowUpPass(
            stage = AuthenticatedRelayFollowUpStage.CATALOG,
            delayMs = 0L,
            reason = baseReason,
            forceSessionSync = true,
            requestSessionShellSync = false,
            forceWorkgroupRefresh = true
        )
    }
    delaysMs.forEach { delayMs ->
        val stage = if (delayMs <= 300L) {
            AuthenticatedRelayFollowUpStage.CATCH_UP
        } else {
            AuthenticatedRelayFollowUpStage.STABILIZE
        }
        passes += AuthenticatedRelayFollowUpPass(
            stage = stage,
            delayMs = delayMs,
            reason = "$baseReason:${stage.wireName}:$delayMs",
            forceSessionSync = false,
            requestSessionShellSync = true,
            forceWorkgroupRefresh = false
        )
    }
    return passes
}
