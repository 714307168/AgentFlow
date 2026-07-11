package com.claudecode.remote.data.remote

import org.junit.Assert.assertEquals
import org.junit.Test

class RelayWebSocketUrlTest {

    @Test
    fun `normalizeRelayWebSocketUrl targets ws path for relay base URLs`() {
        assertEquals("wss://relay.example.com/ws", normalizeRelayWebSocketUrl("https://relay.example.com"))
        assertEquals("ws://127.0.0.1:8080/ws", normalizeRelayWebSocketUrl("http://127.0.0.1:8080"))
        assertEquals("wss://relay.example.com/ws", normalizeRelayWebSocketUrl("wss://relay.example.com"))
        assertEquals("wss://relay.example.com/ws", normalizeRelayWebSocketUrl("relay.example.com"))
    }

    @Test
    fun `normalizeRelayWebSocketUrl preserves explicit websocket paths`() {
        assertEquals("wss://relay.example.com/ws", normalizeRelayWebSocketUrl("https://relay.example.com/ws"))
        assertEquals("wss://relay.example.com/custom", normalizeRelayWebSocketUrl("wss://relay.example.com/custom"))
        assertEquals("wss://relay.example.com/custom?token=1", normalizeRelayWebSocketUrl("https://relay.example.com/custom?token=1"))
    }
}
