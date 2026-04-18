package com.claudecode.remote.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class AuthenticatedRelayFollowUpPlanTest {

    @Test
    fun buildsImmediateCatalogPassBeforeCatchUpAndStabilizePasses() {
        val passes = buildAuthenticatedRelayFollowUpPasses(
            baseReason = "relay-authenticated",
            delaysMs = longArrayOf(300L, 1_500L, 5_000L)
        )

        assertEquals(
            listOf(
                AuthenticatedRelayFollowUpPass(
                    stage = AuthenticatedRelayFollowUpStage.CATALOG,
                    delayMs = 0L,
                    reason = "relay-authenticated",
                    forceSessionSync = true,
                    requestSessionShellSync = false,
                    forceWorkgroupRefresh = true
                ),
                AuthenticatedRelayFollowUpPass(
                    stage = AuthenticatedRelayFollowUpStage.CATCH_UP,
                    delayMs = 300L,
                    reason = "relay-authenticated:catch-up:300",
                    forceSessionSync = false,
                    requestSessionShellSync = true,
                    forceWorkgroupRefresh = false
                ),
                AuthenticatedRelayFollowUpPass(
                    stage = AuthenticatedRelayFollowUpStage.STABILIZE,
                    delayMs = 1_500L,
                    reason = "relay-authenticated:stabilize:1500",
                    forceSessionSync = false,
                    requestSessionShellSync = true,
                    forceWorkgroupRefresh = false
                ),
                AuthenticatedRelayFollowUpPass(
                    stage = AuthenticatedRelayFollowUpStage.STABILIZE,
                    delayMs = 5_000L,
                    reason = "relay-authenticated:stabilize:5000",
                    forceSessionSync = false,
                    requestSessionShellSync = true,
                    forceWorkgroupRefresh = false
                )
            ),
            passes
        )
    }

    @Test
    fun supportsScheduledOnlyPlans() {
        val passes = buildAuthenticatedRelayFollowUpPasses(
            baseReason = "manual-reconnect",
            delaysMs = longArrayOf(300L, 1_500L),
            includeImmediateCatalogPass = false
        )

        assertEquals(2, passes.size)
        assertEquals(AuthenticatedRelayFollowUpStage.CATCH_UP, passes.first().stage)
        assertEquals("manual-reconnect:catch-up:300", passes.first().reason)
        assertEquals(AuthenticatedRelayFollowUpStage.STABILIZE, passes.last().stage)
        assertEquals("manual-reconnect:stabilize:1500", passes.last().reason)
    }
}
