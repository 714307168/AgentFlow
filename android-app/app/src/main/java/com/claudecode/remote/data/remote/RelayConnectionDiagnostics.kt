package com.claudecode.remote.data.remote

data class RelayConnectionEvent(
    val atMs: Long,
    val type: String,
    val state: String,
    val detail: String? = null,
    val closeCode: Int? = null,
    val closeReason: String? = null,
    val reconnectDelayMs: Long? = null,
    val reconnectAttemptCount: Int? = null
)

data class RelayConnectionSnapshot(
    val state: String,
    val isAuthenticated: Boolean,
    val lastInboundAtMs: Long,
    val lastSocketOpenAttemptAtMs: Long,
    val lastErrorAtMs: Long,
    val lastErrorMessage: String?,
    val lastCloseCode: Int?,
    val lastCloseReason: String?,
    val lastStateChangedAtMs: Long,
    val reconnectAttemptCount: Int,
    val pendingQueueSize: Int,
    val recentEvents: List<RelayConnectionEvent>
)

internal class RelayConnectionDiagnostics(
    private val eventLimit: Int = DEFAULT_EVENT_LIMIT
) {
    private val recentEvents = ArrayDeque<RelayConnectionEvent>()

    @Volatile
    private var lastErrorAtMs: Long = 0L

    @Volatile
    private var lastErrorMessage: String? = null

    @Volatile
    private var lastCloseCode: Int? = null

    @Volatile
    private var lastCloseReason: String? = null

    @Volatile
    private var lastStateChangedAtMs: Long = 0L

    fun onStateChanged(atMs: Long = System.currentTimeMillis()) {
        lastStateChangedAtMs = atMs
    }

    fun onError(message: String?, atMs: Long = System.currentTimeMillis()) {
        val normalizedMessage = message?.trim()?.takeIf { it.isNotEmpty() }
        lastErrorAtMs = atMs
        lastErrorMessage = normalizedMessage
    }

    fun onClose(code: Int, reason: String?) {
        lastCloseCode = code
        lastCloseReason = reason?.trim()?.takeIf { it.isNotEmpty() }
    }

    @Synchronized
    fun recordEvent(
        type: String,
        state: String,
        detail: String? = null,
        closeCode: Int? = null,
        closeReason: String? = null,
        reconnectDelayMs: Long? = null,
        reconnectAttemptCount: Int? = null,
        atMs: Long = System.currentTimeMillis()
    ) {
        recentEvents.addLast(
            RelayConnectionEvent(
                atMs = atMs,
                type = type,
                state = state,
                detail = detail?.trim()?.takeIf { it.isNotEmpty() },
                closeCode = closeCode,
                closeReason = closeReason?.trim()?.takeIf { it.isNotEmpty() },
                reconnectDelayMs = reconnectDelayMs,
                reconnectAttemptCount = reconnectAttemptCount
            )
        )
        while (recentEvents.size > eventLimit) {
            recentEvents.removeFirst()
        }
    }

    @Synchronized
    fun snapshot(
        state: String,
        isAuthenticated: Boolean,
        lastInboundAtMs: Long,
        lastSocketOpenAttemptAtMs: Long,
        reconnectAttemptCount: Int,
        pendingQueueSize: Int
    ): RelayConnectionSnapshot = RelayConnectionSnapshot(
        state = state,
        isAuthenticated = isAuthenticated,
        lastInboundAtMs = lastInboundAtMs,
        lastSocketOpenAttemptAtMs = lastSocketOpenAttemptAtMs,
        lastErrorAtMs = lastErrorAtMs,
        lastErrorMessage = lastErrorMessage,
        lastCloseCode = lastCloseCode,
        lastCloseReason = lastCloseReason,
        lastStateChangedAtMs = lastStateChangedAtMs,
        reconnectAttemptCount = reconnectAttemptCount,
        pendingQueueSize = pendingQueueSize,
        recentEvents = recentEvents.toList()
    )

    companion object {
        private const val DEFAULT_EVENT_LIMIT = 24
    }
}

internal fun buildRelayConnectionDiagnosticsNote(
    snapshot: RelayConnectionSnapshot,
    prefix: String? = null
): String {
    val parts = mutableListOf<String>()
    prefix?.trim()?.takeIf { it.isNotEmpty() }?.let(parts::add)
    parts += "relayState=${snapshot.state}"
    parts += "authenticated=${snapshot.isAuthenticated}"
    parts += "reconnectAttempts=${snapshot.reconnectAttemptCount}"
    parts += "pendingQueue=${snapshot.pendingQueueSize}"
    if (snapshot.lastInboundAtMs > 0L) {
        parts += "lastInboundAtMs=${snapshot.lastInboundAtMs}"
    }
    if (snapshot.lastSocketOpenAttemptAtMs > 0L) {
        parts += "lastSocketOpenAttemptAtMs=${snapshot.lastSocketOpenAttemptAtMs}"
    }
    if (snapshot.lastStateChangedAtMs > 0L) {
        parts += "lastStateChangedAtMs=${snapshot.lastStateChangedAtMs}"
    }
    snapshot.lastCloseCode?.let { code ->
        val reason = snapshot.lastCloseReason?.takeIf { it.isNotBlank() } ?: "none"
        parts += "lastClose=${code}/${reason}"
    }
    snapshot.lastErrorMessage?.takeIf { it.isNotBlank() }?.let { message ->
        parts += "lastError=${message}"
    }
    if (snapshot.recentEvents.isNotEmpty()) {
        parts += "recentEvents=" + snapshot.recentEvents.takeLast(6).joinToString(" || ") { event ->
            buildString {
                append(event.type)
                append("@")
                append(event.atMs)
                append("[")
                append(event.state)
                append("]")
                event.reconnectAttemptCount?.let {
                    append("#")
                    append(it)
                }
                event.reconnectDelayMs?.let {
                    append("+")
                    append(it)
                    append("ms")
                }
                event.closeCode?.let {
                    append(" close=")
                    append(it)
                }
                event.closeReason?.let {
                    append("(")
                    append(it)
                    append(")")
                }
                event.detail?.takeIf { it.isNotBlank() }?.let {
                    append(" ")
                    append(it)
                }
            }
        }
    }
    return parts.joinToString("; ")
}
