package com.claudecode.remote.data.remote

import android.util.Log
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.TimeUnit

class RelayWebSocket(
    private val serverUrl: String,
    private val tokenStore: TokenStore
) {
    private val tag = "RelayWebSocket"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    private val _incomingEnvelopes = MutableSharedFlow<Envelope>(extraBufferCapacity = 64)
    val incomingEnvelopes: SharedFlow<Envelope> = _incomingEnvelopes.asSharedFlow()

    private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _errorMessage = MutableStateFlow<String?>(null)
    val errorMessage: StateFlow<String?> = _errorMessage.asStateFlow()

    private var webSocket: WebSocket? = null
    private var lastSeq: Long = 0
    private var reconnectAttempts = 0
    private var pingJob: Job? = null
    private var reconnectJob: Job? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .build()

    enum class ConnectionState { DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING }

    suspend fun connect() {
        if (_connectionState.value == ConnectionState.CONNECTED ||
            _connectionState.value == ConnectionState.CONNECTING) return

        // Check if token exists
        val token = tokenStore.getToken()
        if (token.isNullOrEmpty()) {
            _errorMessage.value = "请先在设置中配置 Token 和 Device ID"
            _connectionState.value = ConnectionState.DISCONNECTED
            return
        }

        _connectionState.value = ConnectionState.CONNECTING
        _errorMessage.value = null
        reconnectAttempts = 0
        openWebSocket()
    }

    fun disconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
        stopPing()
        webSocket?.close(1000, "User disconnected")
        webSocket = null
        _connectionState.value = ConnectionState.DISCONNECTED
        Log.d(tag, "WebSocket disconnected by user")
    }

    private fun openWebSocket() {
        val wsUrl = serverUrl
            .replace("http://", "ws://")
            .replace("https://", "wss://")
            .trimEnd('/') + "/ws"
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, createListener())
    }

    private fun createListener() = object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            Log.d(tag, "WebSocket opened")
            _connectionState.value = ConnectionState.CONNECTED
            reconnectAttempts = 0
            authenticate()
            startPing()
        }

        override fun onMessage(ws: WebSocket, text: String) {
            try {
                val envelope = json.decodeFromString<Envelope>(text)
                envelope.seq?.let { if (it > lastSeq) lastSeq = it }

                // Handle auth errors
                if (envelope.event == Events.AUTH_ERROR) {
                    _errorMessage.value = "认证失败，请检查 Token 是否正确"
                    _connectionState.value = ConnectionState.DISCONNECTED
                    ws.close(1000, "Auth failed")
                    return
                }

                // Handle auth success
                if (envelope.event == Events.AUTH_OK) {
                    _errorMessage.value = null
                    Log.d(tag, "Authentication successful")
                }

                scope.launch { _incomingEnvelopes.emit(envelope) }
            } catch (e: Exception) {
                Log.e(tag, "Failed to parse envelope: $text", e)
            }
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            val errorMsg = "连接失败: ${t.message ?: "未知错误"}"
            Log.e(tag, "WebSocket failure: ${t.message}, response: ${response?.code}", t)
            _errorMessage.value = errorMsg
            _connectionState.value = ConnectionState.RECONNECTING
            stopPing()
            scheduleReconnect()
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            Log.d(tag, "WebSocket closed: code=$code, reason=$reason")
            if (code != 1000) { // 1000 = normal closure
                _errorMessage.value = "连接关闭: $reason (code: $code)"
            }
            if (_connectionState.value != ConnectionState.DISCONNECTED) {
                _connectionState.value = ConnectionState.RECONNECTING
                scheduleReconnect()
            }
            stopPing()
        }
    }

    private fun authenticate() {
        val token = tokenStore.getToken()
        val deviceId = tokenStore.getDeviceId()
        val event = if (lastSeq > 0) Events.AUTH_RESUME else Events.AUTH_LOGIN
        val payload = buildJsonObject {
            put("token", JsonPrimitive(token ?: ""))
            put("type", JsonPrimitive("device"))
            if (!deviceId.isNullOrBlank()) {
                put("device_id", JsonPrimitive(deviceId))
            }
            if (lastSeq > 0) put("last_seq", JsonPrimitive(lastSeq))
        }
        send(
            Envelope(
                id = UUID.randomUUID().toString(),
                event = event,
                payload = payload,
                ts = System.currentTimeMillis()
            )
        )
    }

    fun send(envelope: Envelope) {
        try {
            val text = json.encodeToString(envelope)
            webSocket?.send(text)
        } catch (e: Exception) {
            Log.e(tag, "Failed to send envelope", e)
        }
    }

    private fun startPing() {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (true) {
                delay(30_000)
                if (_connectionState.value == ConnectionState.CONNECTED) {
                    send(
                        Envelope(
                            id = UUID.randomUUID().toString(),
                            event = Events.PING,
                            ts = System.currentTimeMillis()
                        )
                    )
                }
            }
        }
    }

    private fun stopPing() {
        pingJob?.cancel()
        pingJob = null
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val backoffSeconds = minOf(30L, 1L shl reconnectAttempts)
            Log.d(tag, "Reconnecting in ${backoffSeconds}s (attempt ${reconnectAttempts + 1})")
            delay(backoffSeconds * 1000)
            reconnectAttempts++
            openWebSocket()
        }
    }
}
