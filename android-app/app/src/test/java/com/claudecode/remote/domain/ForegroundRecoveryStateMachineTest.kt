package com.claudecode.remote.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundRecoveryStateMachineTest {

    @Test
    fun `buildForegroundRecoveryPasses maps stages and force reconnect to the first pass only`() {
        val passes = buildForegroundRecoveryPasses(
            baseReason = "activity-resume",
            delaysMs = longArrayOf(0L, 1_500L, 5_000L),
            forceReconnectInitial = true
        )

        assertEquals(
            listOf(
                ForegroundRecoveryStage.CONNECT,
                ForegroundRecoveryStage.AUTH,
                ForegroundRecoveryStage.CATCH_UP
            ),
            passes.map { it.stage }
        )
        assertEquals(
            listOf(
                "activity-resume:connect:0",
                "activity-resume:auth:1500",
                "activity-resume:catch-up:5000"
            ),
            passes.map { it.reason }
        )
        assertEquals(listOf(true, false, false), passes.map { it.forceReconnect })
    }

    @Test
    fun `decideForegroundConnectionRecovery prefers token refresh reconnect over passive health checks`() {
        val pass = buildForegroundRecoveryPasses(
            baseReason = "network-available",
            delaysMs = longArrayOf(0L),
            forceReconnectInitial = false
        ).first()

        val decision = decideForegroundConnectionRecovery(pass, tokenChanged = true)

        assertEquals(ForegroundConnectionRecoveryAction.FORCE_RECONNECT, decision.action)
        assertEquals("network-available:connect:0-token-refresh", decision.reason)
    }

    @Test
    fun `shouldScheduleNetworkRecovery debounces repeated network available events`() {
        assertTrue(
            shouldScheduleNetworkRecovery(
                nowMs = 10_000L,
                lastScheduledAtMs = 0L,
                minIntervalMs = 5_000L
            )
        )
        assertFalse(
            shouldScheduleNetworkRecovery(
                nowMs = 12_000L,
                lastScheduledAtMs = 10_000L,
                minIntervalMs = 5_000L
            )
        )
        assertTrue(
            shouldScheduleNetworkRecovery(
                nowMs = 16_000L,
                lastScheduledAtMs = 10_000L,
                minIntervalMs = 5_000L
            )
        )
    }

    @Test
    fun `shouldForceForegroundReconnect forces cold start and long background restores`() {
        assertTrue(
            shouldForceForegroundReconnect(
                nowMs = 10_000L,
                lastStoppedAtMs = 0L,
                thresholdMs = 30_000L
            )
        )
        assertFalse(
            shouldForceForegroundReconnect(
                nowMs = 20_000L,
                lastStoppedAtMs = 10_000L,
                thresholdMs = 30_000L
            )
        )
        assertTrue(
            shouldForceForegroundReconnect(
                nowMs = 45_000L,
                lastStoppedAtMs = 10_000L,
                thresholdMs = 30_000L
            )
        )
    }
}
