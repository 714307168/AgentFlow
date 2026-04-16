package com.claudecode.remote.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayConnectionDiagnosticsTest {

    @Test
    fun `snapshot keeps bounded recent event history and close metadata`() {
        val diagnostics = RelayConnectionDiagnostics(eventLimit = 3)
        diagnostics.onStateChanged(atMs = 10L)
        diagnostics.recordEvent("connect-attempt", "connecting", detail = "generation=1", atMs = 11L)
        diagnostics.recordEvent("socket-open", "connected", atMs = 12L)
        diagnostics.recordEvent("authenticated", "connected", atMs = 13L)
        diagnostics.onError("timeout", atMs = 14L)
        diagnostics.onClose(1006, "abnormal")
        diagnostics.recordEvent("socket-close", "reconnecting", closeCode = 1006, closeReason = "abnormal", atMs = 16L)
        diagnostics.recordEvent("reconnect-scheduled", "reconnecting", reconnectDelayMs = 1000L, reconnectAttemptCount = 1, atMs = 17L)

        val snapshot = diagnostics.snapshot(
            state = "reconnecting",
            isAuthenticated = false,
            lastInboundAtMs = 100L,
            lastSocketOpenAttemptAtMs = 90L,
            reconnectAttemptCount = 1,
            pendingQueueSize = 2
        )

        assertEquals(1006, snapshot.lastCloseCode)
        assertEquals("abnormal", snapshot.lastCloseReason)
        assertEquals("timeout", snapshot.lastErrorMessage)
        assertEquals(3, snapshot.recentEvents.size)
        assertEquals("authenticated", snapshot.recentEvents.first().type)
        assertEquals("reconnect-scheduled", snapshot.recentEvents.last().type)
    }

    @Test
    fun `diagnostics note includes recent event summary`() {
        val snapshot = RelayConnectionSnapshot(
            state = "reconnecting",
            isAuthenticated = false,
            lastInboundAtMs = 200L,
            lastSocketOpenAttemptAtMs = 150L,
            lastErrorAtMs = 250L,
            lastErrorMessage = "relay timeout",
            lastCloseCode = 1006,
            lastCloseReason = "abnormal",
            lastStateChangedAtMs = 260L,
            reconnectAttemptCount = 2,
            pendingQueueSize = 1,
            recentEvents = listOf(
                RelayConnectionEvent(
                    atMs = 210L,
                    type = "socket-close",
                    state = "reconnecting",
                    closeCode = 1006,
                    closeReason = "abnormal",
                    detail = "wasAuthenticated=true"
                ),
                RelayConnectionEvent(
                    atMs = 220L,
                    type = "reconnect-scheduled",
                    state = "reconnecting",
                    reconnectDelayMs = 2000L,
                    reconnectAttemptCount = 2,
                    detail = "delay=2000"
                )
            )
        )

        val note = buildRelayConnectionDiagnosticsNote(snapshot, "Android diagnostics upload.")

        assertTrue(note.contains("Android diagnostics upload."))
        assertTrue(note.contains("lastClose=1006/abnormal"))
        assertTrue(note.contains("lastError=relay timeout"))
        assertTrue(note.contains("recentEvents=socket-close@210"))
        assertTrue(note.contains("reconnect-scheduled@220"))
    }
}
