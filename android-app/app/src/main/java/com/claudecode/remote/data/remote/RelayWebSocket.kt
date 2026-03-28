package com.claudecode.remote.data.remote

import android.util.Log
import com.claudecode.remote.data.crypto.E2ECrypto
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.TimeUnit

class RelayWebSocket(
    private var serverUrl: String,
    private val tokenStore: TokenStore,
    private val e2eCrypto: E2ECrypto
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
    private var e2eEnabled: Boolean = tokenStore.isE2EEnabled()
    private val pendingRoomKeyOffers = mutableSetOf<String>()
    private val pendingEncryptedEnvelopes = mutableMapOf<String, MutableList<Envelope>>()
    private val connectionMutex = Mutex()
    private var connectionGeneration: Long = 0

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .build()

    enum class ConnectionState { DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING }

    data class RelayEncryptedPayload(
        val ciphertext: String,
        val nonce: String,
        val encrypted: Boolean,
        val senderId: String? = null,
        val keyId: String? = null
    )

    fun updateServerUrl(newUrl: String) {
        serverUrl = newUrl.trim()
        Log.d(tag, "Server URL updated: $serverUrl")
    }

    fun setE2EEnabled(enabled: Boolean) {
        e2eEnabled = enabled
    }

    suspend fun connect() {
        connectionMutex.withLock {
            if (_connectionState.value == ConnectionState.CONNECTED ||
                _connectionState.value == ConnectionState.CONNECTING ||
                _connectionState.value == ConnectionState.RECONNECTING
            ) {
                return
            }

            val token = tokenStore.getToken()
            val deviceId = tokenStore.getDeviceId()
            if (token.isNullOrEmpty() || deviceId.isNullOrEmpty()) {
                _errorMessage.value = "请先在设置中配置 Token 和 Device ID"
                _connectionState.value = ConnectionState.DISCONNECTED
                return
            }

            _connectionState.value = ConnectionState.CONNECTING
            _errorMessage.value = null
            reconnectAttempts = 0
            openWebSocketLocked()
        }
    }

    fun disconnect() {
        scope.launch {
            connectionMutex.withLock {
                reconnectJob?.cancel()
                reconnectJob = null
                stopPing()
                pendingRoomKeyOffers.clear()
                pendingEncryptedEnvelopes.clear()
                connectionGeneration += 1
                webSocket?.close(1000, "User disconnected")
                webSocket = null
                _connectionState.value = ConnectionState.DISCONNECTED
                Log.d(tag, "WebSocket disconnected by user")
            }
        }
    }

    private fun openWebSocketLocked() {
        val wsUrl = toWsUrl(serverUrl)
        connectionGeneration += 1
        val generation = connectionGeneration
        webSocket?.cancel()
        Log.d(tag, "Opening WebSocket: $wsUrl generation=$generation")
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, createListener(generation))
    }

    private fun createListener(generation: Long) = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!isCurrentSocket(generation, webSocket)) {
                webSocket.cancel()
                return
            }
            Log.d(tag, "WebSocket opened generation=$generation")
            _connectionState.value = ConnectionState.CONNECTED
            reconnectAttempts = 0
            authenticate()
            startPing()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!isCurrentSocket(generation, webSocket)) {
                return
            }
            try {
                val envelope = json.decodeFromString<Envelope>(text)
                envelope.seq?.let { if (it > lastSeq) lastSeq = it }

                if (envelope.event == Events.AUTH_ERROR) {
                    _errorMessage.value = "认证失败，请检查 Token 是否正确"
                    _connectionState.value = ConnectionState.DISCONNECTED
                    webSocket.close(1000, "Auth failed")
                    return
                }

                if (envelope.event == Events.AUTH_OK) {
                    _errorMessage.value = null
                    Log.d(tag, "Authentication successful generation=$generation")
                    extractAgentId(envelope)?.let(::ensureRoomKey)
                }

                if (envelope.event == Events.E2E_ANSWER) {
                    handleE2EAnswer(envelope)
                    return
                }

                val decryptedEnvelope = decryptIncomingEnvelope(envelope)
                if (decryptedEnvelope.event == Events.PROJECT_LISTED) {
                    extractAgentId(decryptedEnvelope)?.let(::ensureRoomKey)
                }

                scope.launch { _incomingEnvelopes.emit(decryptedEnvelope) }
            } catch (e: Exception) {
                Log.e(tag, "Failed to parse envelope: $text", e)
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!isCurrentSocket(generation, webSocket)) {
                return
            }
            val errorMsg = "连接失败: ${t.message ?: "未知错误"}"
            Log.e(tag, "WebSocket failure generation=$generation response=${response?.code}", t)
            _errorMessage.value = errorMsg
            _connectionState.value = ConnectionState.RECONNECTING
            stopPing()
            scheduleReconnect(generation)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (!isCurrentSocket(generation, webSocket)) {
                return
            }
            Log.d(tag, "WebSocket closed generation=$generation code=$code reason=$reason")
            if (code != 1000) {
                _errorMessage.value = "连接关闭: $reason (code: $code)"
            }
            if (_connectionState.value != ConnectionState.DISCONNECTED) {
                _connectionState.value = ConnectionState.RECONNECTING
                scheduleReconnect(generation)
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
            if (lastSeq > 0) {
                put("last_seq", JsonPrimitive(lastSeq))
            }
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

    fun send(envelope: Envelope, targetAgentId: String? = null) {
        try {
            val outgoing = prepareOutgoingEnvelope(envelope, targetAgentId) ?: return
            if (_connectionState.value != ConnectionState.CONNECTED || webSocket == null) {
                Log.w(tag, "Dropping send while disconnected event=${envelope.event}")
                return
            }
            val text = json.encodeToString(outgoing)
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

    private fun scheduleReconnect(generation: Long) {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            val backoffSeconds = minOf(30L, 1L shl reconnectAttempts)
            Log.d(tag, "Reconnecting in ${backoffSeconds}s generation=$generation attempt=${reconnectAttempts + 1}")
            delay(backoffSeconds * 1000)
            connectionMutex.withLock {
                if (_connectionState.value == ConnectionState.DISCONNECTED || generation != connectionGeneration) {
                    return@withLock
                }
                reconnectAttempts++
                _connectionState.value = ConnectionState.RECONNECTING
                openWebSocketLocked()
            }
        }
    }

    private fun toWsUrl(rawUrl: String): String {
        val trimmed = rawUrl.trim().trimEnd('/')
        if (trimmed.isEmpty()) {
            return "ws://localhost:8080/ws"
        }

        return when {
            (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) && trimmed.endsWith("/ws") -> trimmed
            trimmed.startsWith("http://") -> "ws://${trimmed.removePrefix("http://")}/ws"
            trimmed.startsWith("https://") -> "wss://${trimmed.removePrefix("https://")}/ws"
            trimmed.startsWith("ws://") || trimmed.startsWith("wss://") -> "$trimmed/ws"
            else -> "ws://$trimmed/ws"
        }
    }

    private fun shouldEncryptEvent(event: String): Boolean = event !in setOf(
        Events.AUTH_LOGIN,
        Events.AUTH_RESUME,
        Events.AUTH_OK,
        Events.AUTH_ERROR,
        Events.PING,
        Events.PONG,
        Events.PROJECT_BIND,
        Events.PROJECT_BOUND,
        Events.PROJECT_LIST,
        Events.PROJECT_LIST_REQUEST,
        Events.PROJECT_LISTED,
        Events.AGENT_STATUS,
        Events.E2E_OFFER,
        Events.E2E_ANSWER
    )

    private fun resolveTargetAgentId(envelope: Envelope, explicitAgentId: String?): String {
        val direct = explicitAgentId?.trim().orEmpty()
        if (direct.isNotEmpty()) {
            return direct
        }
        val envelopeAgentId = envelope.agentId?.trim().orEmpty()
        if (envelopeAgentId.isNotEmpty()) {
            return envelopeAgentId
        }
        val payload = envelope.payload
        val payloadObject = payload as? JsonObject ?: return ""
        return payloadObject["agent_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
    }

    private fun extractAgentId(envelope: Envelope): String? {
        envelope.agentId?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        return extractAgentId(envelope.payload)
    }

    private fun extractAgentId(payload: JsonElement?): String? {
        val payloadObject = payload as? JsonObject ?: return null
        return payloadObject["agent_id"]?.jsonPrimitive?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
    }

    private fun prepareOutgoingEnvelope(envelope: Envelope, targetAgentId: String?): Envelope? {
        if (!e2eEnabled || envelope.payload == null || !shouldEncryptEvent(envelope.event)) {
            return envelope
        }

        val normalizedAgentId = resolveTargetAgentId(envelope, targetAgentId)
        if (normalizedAgentId.isBlank()) {
            return envelope
        }

        if (!e2eCrypto.hasRoomKey(normalizedAgentId)) {
            ensureRoomKey(normalizedAgentId)
            queuePendingEncryptedEnvelope(normalizedAgentId, envelope)
            return null
        }

        val encrypted = e2eCrypto.encryptWithRoomKey(
            normalizedAgentId,
            json.encodeToString(JsonElement.serializer(), envelope.payload)
        ) ?: return envelope

        return envelope.copy(
            payload = buildJsonObject {
                put("ciphertext", JsonPrimitive(encrypted.ciphertext))
                put("nonce", JsonPrimitive(encrypted.nonce))
                put("encrypted", JsonPrimitive(true))
                tokenStore.getDeviceId()?.trim()?.takeIf { it.isNotEmpty() }?.let {
                    put("sender_id", JsonPrimitive(it))
                }
                put("key_id", JsonPrimitive("agent:$normalizedAgentId"))
            }
        )
    }
    
    private fun decryptIncomingEnvelope(envelope: Envelope): Envelope {
        if (!e2eEnabled) {
            return envelope
        }
        val payloadObject = envelope.payload as? JsonObject ?: return envelope
        if (payloadObject["encrypted"]?.jsonPrimitive?.contentOrNull != "true") {
            return envelope
        }

        val encryptedPayload = RelayEncryptedPayload(
            ciphertext = payloadObject["ciphertext"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            nonce = payloadObject["nonce"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            encrypted = true,
            senderId = payloadObject["sender_id"]?.jsonPrimitive?.contentOrNull,
            keyId = payloadObject["key_id"]?.jsonPrimitive?.contentOrNull
        )

        var decrypted = encryptedPayload.keyId
            ?.removePrefix("agent:")
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let { roomId ->
                e2eCrypto.decryptWithRoomKey(
                    roomId,
                    E2ECrypto.EncryptedPayload(
                        ciphertext = encryptedPayload.ciphertext,
                        nonce = encryptedPayload.nonce,
                        encrypted = true
                    )
                )
            }

        if (decrypted == null) {
            decrypted = encryptedPayload.senderId
                ?.trim()
                ?.takeIf { it.isNotEmpty() && e2eCrypto.hasKey(it) }
                ?.let { peerId ->
                    e2eCrypto.decrypt(
                        peerId,
                        E2ECrypto.EncryptedPayload(
                            ciphertext = encryptedPayload.ciphertext,
                            nonce = encryptedPayload.nonce,
                            encrypted = true
                        )
                    )
                }
        }

        if (decrypted.isNullOrBlank()) {
            return envelope
        }

        return try {
            envelope.copy(payload = json.parseToJsonElement(decrypted))
        } catch (error: Exception) {
            Log.e(tag, "Failed to parse decrypted payload", error)
            envelope
        }
    }

    private fun handleE2EAnswer(envelope: Envelope) {
        val payload = envelope.payload?.jsonObject ?: return
        val agentId = payload["agent_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val publicKey = payload["public_key"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val ciphertext = payload["ciphertext"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val nonce = payload["nonce"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (agentId.isBlank() || publicKey.isBlank() || ciphertext.isBlank() || nonce.isBlank()) {
            return
        }

        e2eCrypto.deriveSharedSecret(agentId, publicKey)
        val roomPayload = e2eCrypto.decrypt(
            agentId,
            E2ECrypto.EncryptedPayload(
                ciphertext = ciphertext,
                nonce = nonce,
                encrypted = true
            )
        ) ?: return

        runCatching {
            json.parseToJsonElement(roomPayload).jsonObject
        }.getOrNull()?.let { roomObject ->
            val roomKey = roomObject["room_key"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val roomAgentId = roomObject["agent_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty().ifEmpty { agentId }
            if (roomKey.isNotBlank()) {
                e2eCrypto.setRoomKey(roomAgentId, roomKey)
                pendingRoomKeyOffers.remove(roomAgentId)
                flushPendingEncryptedEnvelopes(roomAgentId)
            }
        }
    }

    private fun ensureRoomKey(agentId: String) {
        val normalizedAgentId = agentId.trim()
        val deviceId = tokenStore.getDeviceId()?.trim().orEmpty()
        if (
            !e2eEnabled ||
            normalizedAgentId.isEmpty() ||
            deviceId.isEmpty() ||
            pendingRoomKeyOffers.contains(normalizedAgentId) ||
            e2eCrypto.hasRoomKey(normalizedAgentId)
        ) {
            return
        }

        pendingRoomKeyOffers.add(normalizedAgentId)
        send(
            Envelope(
                id = UUID.randomUUID().toString(),
                event = Events.E2E_OFFER,
                payload = buildJsonObject {
                    put("public_key", JsonPrimitive(e2eCrypto.getPublicKeyBase64()))
                    put("agent_id", JsonPrimitive(normalizedAgentId))
                    put("device_id", JsonPrimitive(deviceId))
                },
                ts = System.currentTimeMillis()
            ),
            targetAgentId = normalizedAgentId
        )
    }

    private fun queuePendingEncryptedEnvelope(agentId: String, envelope: Envelope) {
        val queue = pendingEncryptedEnvelopes.getOrPut(agentId) { mutableListOf() }
        queue.add(envelope)
    }

    private fun flushPendingEncryptedEnvelopes(agentId: String) {
        val queued = pendingEncryptedEnvelopes.remove(agentId).orEmpty()
        queued.forEach { envelope ->
            send(envelope, targetAgentId = agentId)
        }
    }

    private fun isCurrentSocket(generation: Long, candidate: WebSocket): Boolean =
        generation == connectionGeneration && candidate == webSocket
}
