package com.claudecode.remote.ui.workgroup

import android.content.Context
import com.claudecode.remote.R
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.WorkgroupMember
import com.claudecode.remote.data.model.WorkgroupMessage
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.WorkgroupRepository
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val WORKGROUP_DRAFT_PREFIX = "workgroup:"
private const val WORKGROUP_VISIBLE_PAGE_SIZE = 30
private const val WORKGROUP_INITIAL_SYNC_PAGE_SIZE = 80
private const val WORKGROUP_INCREMENTAL_SYNC_PAGE_SIZE = 32
private const val WORKGROUP_ACTIVE_SYNC_POLL_MS = 5_000L
private const val WORKGROUP_IDLE_SYNC_POLL_MS = 12_000L
private const val WORKGROUP_ACTIVE_SYNC_BURST_MS = 8_000L
private const val WORKGROUP_SYNC_TRIGGER_DEBOUNCE_MS = 250L
private const val WORKGROUP_RESUME_STALE_CONNECTION_TIMEOUT_MS = 20_000L
private const val WORKGROUP_ACTIVE_SYNC_STALE_CONNECTION_TIMEOUT_MS = 20_000L
private val WORKGROUP_POST_SEND_SYNC_DELAYS_MS = longArrayOf(0L, 1_200L, 4_000L, 9_000L)

data class WorkgroupMentionSuggestion(
    val token: String,
    val label: String,
    val meta: String,
    val kind: String
)

data class WorkgroupChatUiState(
    val agentId: String = "",
    val workgroupId: String = "",
    val workgroupName: String = "",
    val description: String? = null,
    val members: List<WorkgroupMember> = emptyList(),
    val messages: List<WorkgroupMessage> = emptyList(),
    val inputText: String = "",
    val isConnected: Boolean = false,
    val isRunning: Boolean = false,
    val isSending: Boolean = false,
    val isLoading: Boolean = false,
    val isLoadingOlder: Boolean = false,
    val hasMoreHistory: Boolean = false,
    val mentionSuggestions: List<WorkgroupMentionSuggestion> = emptyList(),
    val error: String? = null
)

class WorkgroupChatViewModel(
    private val context: Context,
    private val workgroupRepository: WorkgroupRepository,
    private val webSocket: RelayWebSocket,
    private val tokenStore: TokenStore
) : ViewModel() {
    private data class PendingOlderHistoryRequest(
        val previousFirstMessageId: String?,
        val previousSize: Int,
        val visibleMessageCount: Int
    )

    private val _uiState = MutableStateFlow(WorkgroupChatUiState())
    val uiState: StateFlow<WorkgroupChatUiState> = _uiState.asStateFlow()

    private var sessionsJob: Job? = null
    private var currentSessionKey: String? = null
    private var allMessages: List<WorkgroupMessage> = emptyList()
    private var visibleMessageCount: Int = WORKGROUP_VISIBLE_PAGE_SIZE
    private var activeSyncJob: Job? = null
    private var pendingSyncTriggerJob: Job? = null
    private var pendingOlderHistoryRequest: PendingOlderHistoryRequest? = null
    private var syncBurstUntilMillis: Long = 0L
    private val postSendSyncJobs = mutableListOf<Job>()

    private fun text(resId: Int, vararg args: Any): String = context.getString(resId, *args)

    init {
        viewModelScope.launch {
            webSocket.connectionState.collect { state ->
                val isConnected = state == RelayWebSocket.ConnectionState.CONNECTED
                _uiState.update { it.copy(isConnected = isConnected) }
                if (isConnected) {
                    triggerImmediateSync(
                        debounceMs = 0L,
                        recentLimit = WORKGROUP_INITIAL_SYNC_PAGE_SIZE
                    )
                    startActiveSyncLoop()
                } else {
                    activeSyncJob?.cancel()
                    activeSyncJob = null
                    pendingSyncTriggerJob?.cancel()
                    pendingSyncTriggerJob = null
                }
            }
        }

        viewModelScope.launch {
            webSocket.incomingEnvelopes.collect { envelope ->
                val state = _uiState.value
                val activeAgentId = state.agentId.trim()
                val activeWorkgroupId = state.workgroupId.trim()
                if (activeAgentId.isEmpty() || activeWorkgroupId.isEmpty()) {
                    return@collect
                }

                val envelopeAgentId = envelope.agentId?.trim().orEmpty()
                val envelopeWorkgroupId = envelope.workgroupId?.trim().orEmpty()
                when (envelope.event) {
                    Events.WORKGROUP_COLLABORATION_SNAPSHOT,
                    Events.WORKGROUP_COLLABORATION_MESSAGE_RESULT,
                    Events.WORKGROUP_COLLABORATION_SESSION -> {
                        if (envelopeAgentId == activeAgentId && envelopeWorkgroupId == activeWorkgroupId) {
                            triggerImmediateSync(recentLimit = WORKGROUP_INCREMENTAL_SYNC_PAGE_SIZE)
                        }
                    }

                    Events.WORKGROUP_COLLABORATION_LIST -> {
                        if (envelopeAgentId == activeAgentId) {
                            triggerImmediateSync(recentLimit = WORKGROUP_INCREMENTAL_SYNC_PAGE_SIZE)
                        }
                    }
                }
            }
        }
    }

    fun loadWorkgroup(agentId: String, workgroupId: String, workgroupName: String) {
        if (agentId.isBlank() || workgroupId.isBlank()) {
            return
        }
        currentSessionKey = sessionKey(agentId, workgroupId)
        allMessages = emptyList()
        visibleMessageCount = WORKGROUP_VISIBLE_PAGE_SIZE
        pendingOlderHistoryRequest = null
        cancelPostSendSyncNudges()
        _uiState.update {
            it.copy(
                agentId = agentId,
                workgroupId = workgroupId,
                workgroupName = workgroupName,
                description = null,
                members = emptyList(),
                messages = emptyList(),
                inputText = tokenStore.getDraft(draftKey(agentId, workgroupId)),
                isRunning = false,
                isLoading = true,
                isLoadingOlder = false,
                hasMoreHistory = false,
                isSending = false,
                mentionSuggestions = buildMentionSuggestions(
                    text = tokenStore.getDraft(draftKey(agentId, workgroupId)),
                    members = emptyList()
                ),
                error = null
            )
        }

        sessionsJob?.cancel()
        activeSyncJob?.cancel()
        activeSyncJob = null
        pendingSyncTriggerJob?.cancel()
        pendingSyncTriggerJob = null
        sessionsJob = viewModelScope.launch {
            workgroupRepository.sessions.collect { sessions ->
                val session = sessions[currentSessionKey] ?: return@collect
                val previousMessages = allMessages
                allMessages = session.messages
                reconcilePendingOlderHistory(
                    previousMessages = previousMessages,
                    nextMessages = session.messages,
                    hasMoreRemoteHistory = session.hasMoreHistory
                )
                _uiState.update { current ->
                    current.copy(
                        workgroupName = session.workgroupName.ifBlank { current.workgroupName },
                        description = session.description,
                        members = session.members,
                        isRunning = session.isRunning,
                        mentionSuggestions = buildMentionSuggestions(
                            text = current.inputText,
                            members = session.members
                        ),
                        isLoading = false,
                        isLoadingOlder = pendingOlderHistoryRequest != null
                    )
                }
                publishVisibleMessages(
                    hasMoreRemoteHistory = session.hasMoreHistory
                )
                maybeLoadMoreHistory()
            }
        }

        requestLatestSessionNow(
            showLoading = true,
            limit = WORKGROUP_INITIAL_SYNC_PAGE_SIZE
        )
        startActiveSyncLoop()
    }

    fun refresh() {
        triggerImmediateSync(
            debounceMs = 0L,
            showLoading = true,
            recentLimit = WORKGROUP_INITIAL_SYNC_PAGE_SIZE
        )
    }

    fun onResume() {
        val state = _uiState.value
        if (state.agentId.isBlank() || state.workgroupId.isBlank()) {
            return
        }
        markSyncBurst()
        viewModelScope.launch {
            try {
                webSocket.ensureHealthyConnection(
                    reason = "workgroup-resume:${state.agentId}:${state.workgroupId}",
                    staleTimeoutMs = WORKGROUP_RESUME_STALE_CONNECTION_TIMEOUT_MS
                )
            } catch (e: Exception) {
                CrashLogger.logError("WorkgroupChatViewModel", "Failed to restore workgroup connection on resume", e)
            }

            if (webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED) {
                requestLatestSessionNow(
                    showLoading = false,
                    limit = WORKGROUP_INITIAL_SYNC_PAGE_SIZE
                )
            }
        }
    }

    fun loadOlderMessages() {
        val state = _uiState.value
        if (state.agentId.isBlank() || state.workgroupId.isBlank() || state.isLoadingOlder || !state.hasMoreHistory) {
            return
        }
        if (visibleMessageCount < allMessages.size) {
            visibleMessageCount += WORKGROUP_VISIBLE_PAGE_SIZE
            publishVisibleMessages(hasMoreRemoteHistory = state.hasMoreHistory)
            maybeLoadMoreHistory()
            return
        }
        val beforeId = state.messages.firstOrNull()?.id ?: return
        pendingOlderHistoryRequest = PendingOlderHistoryRequest(
            previousFirstMessageId = allMessages.firstOrNull()?.id,
            previousSize = allMessages.size,
            visibleMessageCount = visibleMessageCount
        )
        _uiState.update { it.copy(isLoadingOlder = true, error = null) }
        viewModelScope.launch {
            val result = workgroupRepository.requestSession(
                agentId = state.agentId,
                workgroupId = state.workgroupId,
                beforeId = beforeId,
                limit = WORKGROUP_INITIAL_SYNC_PAGE_SIZE
            )
            if (result.isFailure) {
                pendingOlderHistoryRequest = null
                _uiState.update {
                    it.copy(
                        isLoadingOlder = false,
                        error = context.resolveWorkgroupErrorMessage(
                            result.exceptionOrNull(),
                            text(R.string.workgroups_error_load_older)
                        )
                    )
                }
            }
        }
    }

    fun updateInput(text: String) {
        val state = _uiState.value
        if (state.agentId.isNotBlank() && state.workgroupId.isNotBlank()) {
            tokenStore.saveDraft(draftKey(state.agentId, state.workgroupId), text)
        }
        _uiState.update {
            it.copy(
                inputText = text,
                mentionSuggestions = buildMentionSuggestions(text, it.members)
            )
        }
    }

    fun applyMentionSuggestion(suggestion: WorkgroupMentionSuggestion) {
        val state = _uiState.value
        val text = state.inputText
        val match = Regex("(^|\\s)@([^\\s@]*)$").find(text) ?: return
        val replacement = "@${suggestion.token} "
        val updated = text.replaceRange(match.range.first + match.value.indexOf('@'), match.range.last + 1, replacement)
        updateInput(updated)
    }

    fun sendMessage() {
        val state = _uiState.value
        if (state.agentId.isBlank() || state.workgroupId.isBlank() || state.isSending) {
            return
        }
        val textSnapshot = state.inputText
        if (textSnapshot.trim().isEmpty()) {
            return
        }

        tokenStore.clearDraft(draftKey(state.agentId, state.workgroupId))
        _uiState.update { it.copy(inputText = "", isSending = true, mentionSuggestions = emptyList(), error = null) }
        viewModelScope.launch {
            val result = workgroupRepository.sendMessage(
                agentId = state.agentId,
                workgroupId = state.workgroupId,
                content = textSnapshot
            )
            if (result.isFailure) {
                CrashLogger.logError(
                    "WorkgroupChatViewModel",
                    "Failed to send workgroup message",
                    result.exceptionOrNull() as? Exception
                )
                tokenStore.saveDraft(draftKey(state.agentId, state.workgroupId), textSnapshot)
                _uiState.update {
                    it.copy(
                        inputText = textSnapshot,
                        mentionSuggestions = buildMentionSuggestions(textSnapshot, it.members),
                        error = context.resolveWorkgroupErrorMessage(
                            result.exceptionOrNull(),
                            text(R.string.workgroups_error_send_message)
                        )
                    )
                }
            } else {
                schedulePostSendSyncNudges()
            }
            _uiState.update { it.copy(isSending = false) }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    private fun requestLatestSession(showLoading: Boolean) {
        requestLatestSession(
            showLoading = showLoading,
            limit = WORKGROUP_INCREMENTAL_SYNC_PAGE_SIZE
        )
    }

    private fun requestLatestSession(
        showLoading: Boolean,
        limit: Int
    ) {
        requestLatestSession(
            showLoading = showLoading,
            limit = limit,
            bypassDedupe = false
        )
    }

    private fun requestLatestSession(
        showLoading: Boolean,
        limit: Int,
        bypassDedupe: Boolean
    ) {
        val state = _uiState.value
        if (state.agentId.isBlank() || state.workgroupId.isBlank()) {
            return
        }
        if (webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED) {
            _uiState.update { it.copy(isLoading = false) }
            return
        }
        if (showLoading) {
            _uiState.update { it.copy(isLoading = true, error = null) }
        }
        viewModelScope.launch {
            val result = workgroupRepository.requestSession(
                agentId = state.agentId,
                workgroupId = state.workgroupId,
                limit = limit,
                bypassDedupe = bypassDedupe
            )
            if (result.isFailure) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = context.resolveWorkgroupErrorMessage(
                            result.exceptionOrNull(),
                            text(R.string.workgroups_error_load)
                        )
                    )
                }
            }
        }
    }

    private fun requestLatestSessionNow(
        showLoading: Boolean,
        limit: Int
    ) {
        markSyncBurst()
        pendingSyncTriggerJob?.cancel()
        requestLatestSession(
            showLoading = showLoading,
            limit = limit,
            bypassDedupe = true
        )
    }

    private fun publishVisibleMessages(hasMoreRemoteHistory: Boolean) {
        val startIndex = (allMessages.size - visibleMessageCount).coerceAtLeast(0)
        val visibleMessages = allMessages.drop(startIndex)
        _uiState.update {
            it.copy(
                messages = visibleMessages,
                hasMoreHistory = hasMoreRemoteHistory || startIndex > 0
            )
        }
    }

    private fun reconcilePendingOlderHistory(
        previousMessages: List<WorkgroupMessage>,
        nextMessages: List<WorkgroupMessage>,
        hasMoreRemoteHistory: Boolean
    ) {
        val pending = pendingOlderHistoryRequest ?: return
        val prependedCount = calculatePrependedMessageCount(
            previousFirstMessageId = pending.previousFirstMessageId,
            previousMessages = previousMessages,
            nextMessages = nextMessages
        )
        if (prependedCount > 0) {
            visibleMessageCount = maxOf(
                pending.visibleMessageCount + prependedCount,
                visibleMessageCount + prependedCount
            )
            pendingOlderHistoryRequest = null
            return
        }
        val requestSettledWithoutGrowth =
            !hasMoreRemoteHistory &&
                nextMessages.firstOrNull()?.id == pending.previousFirstMessageId
        if (requestSettledWithoutGrowth) {
            pendingOlderHistoryRequest = null
        }
    }

    private fun calculatePrependedMessageCount(
        previousFirstMessageId: String?,
        previousMessages: List<WorkgroupMessage>,
        nextMessages: List<WorkgroupMessage>
    ): Int {
        if (nextMessages.isEmpty()) {
            return 0
        }
        if (previousMessages.isEmpty()) {
            return nextMessages.size
        }
        val anchorId = previousFirstMessageId ?: previousMessages.firstOrNull()?.id ?: return 0
        val anchorIndex = nextMessages.indexOfFirst { it.id == anchorId }
        return when {
            anchorIndex > 0 -> anchorIndex
            anchorIndex == 0 -> 0
            nextMessages.size > previousMessages.size -> nextMessages.size - previousMessages.size
            else -> 0
        }
    }

    private fun maybeLoadMoreHistory() {
        val state = _uiState.value
        if (
            state.agentId.isBlank() ||
            state.workgroupId.isBlank() ||
            state.isLoading ||
            state.isLoadingOlder ||
            !state.hasMoreHistory ||
            !state.isConnected
        ) {
            return
        }
        if (allMessages.size >= visibleMessageCount) {
            return
        }
        val beforeId = state.messages.firstOrNull()?.id ?: return
        pendingOlderHistoryRequest = PendingOlderHistoryRequest(
            previousFirstMessageId = allMessages.firstOrNull()?.id,
            previousSize = allMessages.size,
            visibleMessageCount = visibleMessageCount
        )
        _uiState.update { it.copy(isLoadingOlder = true) }
        viewModelScope.launch {
            val result = workgroupRepository.requestSession(
                agentId = state.agentId,
                workgroupId = state.workgroupId,
                beforeId = beforeId,
                limit = WORKGROUP_INITIAL_SYNC_PAGE_SIZE
            )
            if (result.isFailure) {
                pendingOlderHistoryRequest = null
                _uiState.update {
                    it.copy(
                        isLoadingOlder = false,
                        error = context.resolveWorkgroupErrorMessage(
                            result.exceptionOrNull(),
                            text(R.string.workgroups_error_load_older)
                        )
                    )
                }
            }
        }
    }

    private fun startActiveSyncLoop() {
        activeSyncJob?.cancel()
        activeSyncJob = viewModelScope.launch {
            while (true) {
                val state = _uiState.value
                if (state.agentId.isBlank() || state.workgroupId.isBlank()) {
                    kotlinx.coroutines.delay(WORKGROUP_IDLE_SYNC_POLL_MS)
                    continue
                }
                val now = System.currentTimeMillis()
                val shouldAggressivelySync =
                    state.isSending ||
                        state.isRunning ||
                        state.messages.lastOrNull()?.status == "streaming" ||
                        now < syncBurstUntilMillis
                try {
                    webSocket.ensureHealthyConnection(
                        reason = "workgroup-active-sync:${state.agentId}:${state.workgroupId}",
                        staleTimeoutMs = WORKGROUP_ACTIVE_SYNC_STALE_CONNECTION_TIMEOUT_MS
                    )
                } catch (e: Exception) {
                    CrashLogger.logError("WorkgroupChatViewModel", "Failed to validate workgroup connection during sync", e)
                }
                requestLatestSession(
                    showLoading = false,
                    limit = if (shouldAggressivelySync) {
                        WORKGROUP_INCREMENTAL_SYNC_PAGE_SIZE
                    } else {
                        WORKGROUP_VISIBLE_PAGE_SIZE
                    }
                )
                kotlinx.coroutines.delay(
                    if (shouldAggressivelySync) {
                        WORKGROUP_ACTIVE_SYNC_POLL_MS
                    } else {
                        WORKGROUP_IDLE_SYNC_POLL_MS
                    }
                )
            }
        }
    }

    private fun markSyncBurst(durationMs: Long = WORKGROUP_ACTIVE_SYNC_BURST_MS) {
        syncBurstUntilMillis = System.currentTimeMillis() + durationMs
    }

    private fun schedulePostSendSyncNudges() {
        cancelPostSendSyncNudges()
        WORKGROUP_POST_SEND_SYNC_DELAYS_MS.forEach { delayMs ->
            postSendSyncJobs += viewModelScope.launch {
                if (delayMs > 0L) {
                    kotlinx.coroutines.delay(delayMs)
                }
                requestLatestSessionNow(
                    showLoading = false,
                    limit = WORKGROUP_INCREMENTAL_SYNC_PAGE_SIZE
                )
            }
        }
    }

    private fun cancelPostSendSyncNudges() {
        postSendSyncJobs.forEach(Job::cancel)
        postSendSyncJobs.clear()
    }

    private fun triggerImmediateSync(
        debounceMs: Long = WORKGROUP_SYNC_TRIGGER_DEBOUNCE_MS,
        showLoading: Boolean = false,
        recentLimit: Int = WORKGROUP_INCREMENTAL_SYNC_PAGE_SIZE
    ) {
        markSyncBurst()
        pendingSyncTriggerJob?.cancel()
        pendingSyncTriggerJob = viewModelScope.launch {
            if (debounceMs > 0L) {
                kotlinx.coroutines.delay(debounceMs)
            }
            requestLatestSession(
                showLoading = showLoading,
                limit = recentLimit
            )
        }
    }

    private fun draftKey(agentId: String, workgroupId: String): String =
        "$WORKGROUP_DRAFT_PREFIX${sessionKey(agentId, workgroupId)}"

    private fun sessionKey(agentId: String, workgroupId: String): String =
        "${agentId.trim()}::${workgroupId.trim()}"

    private fun buildMentionSuggestions(
        text: String,
        members: List<WorkgroupMember>
    ): List<WorkgroupMentionSuggestion> {
        val match = Regex("(^|\\s)@([^\\s@]*)$").find(text) ?: return emptyList()
        val query = match.groupValues.getOrNull(2)?.trim()?.lowercase().orEmpty()

        val baseSuggestions = buildList {
            add(
                WorkgroupMentionSuggestion(
                    token = "all",
                    label = "@all",
                    meta = text(R.string.workgroups_mention_all),
                    kind = "all"
                )
            )
            add(
                WorkgroupMentionSuggestion(
                    token = "developer",
                    label = "@developer",
                    meta = text(R.string.workgroups_mention_developer),
                    kind = "role"
                )
            )
            add(
                WorkgroupMentionSuggestion(
                    token = "qa",
                    label = "@qa",
                    meta = text(R.string.workgroups_mention_qa),
                    kind = "role"
                )
            )
            members
                .filter { it.name.isNotBlank() }
                .sortedBy { it.name.lowercase() }
                .forEach { member ->
                    add(
                        WorkgroupMentionSuggestion(
                            token = member.name.trim(),
                            label = "@${member.name.trim()}",
                            meta = translateMemberRole(member.role),
                            kind = "member"
                        )
                    )
                }
        }

        if (query.isBlank()) {
            return baseSuggestions.take(6)
        }

        return baseSuggestions.filter { suggestion ->
            suggestion.token.lowercase().contains(query)
                || suggestion.label.lowercase().contains(query)
                || suggestion.meta.lowercase().contains(query)
        }.take(6)
    }

    private fun translateMemberRole(role: String): String {
        return when (role.trim().lowercase()) {
            "developer" -> text(R.string.workgroups_mention_developer)
            "qa" -> text(R.string.workgroups_mention_qa)
            "project_manager", "pm" -> text(R.string.workgroups_mention_pm)
            else -> text(R.string.workgroups_mention_member)
        }
    }

    override fun onCleared() {
        sessionsJob?.cancel()
        activeSyncJob?.cancel()
        pendingSyncTriggerJob?.cancel()
        cancelPostSendSyncNudges()
        super.onCleared()
    }
}
