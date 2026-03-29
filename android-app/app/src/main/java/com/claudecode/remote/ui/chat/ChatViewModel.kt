package com.claudecode.remote.ui.chat

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.model.MessageAttachment
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.MessageRepository
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

private const val MESSAGE_PAGE_SIZE = 30
private const val INITIAL_SYNC_PAGE_SIZE = 80
private const val INCREMENTAL_SYNC_PAGE_SIZE = 32
private const val ACTIVE_SYNC_OVERLAP_COUNT = 12
private const val ACTIVE_SYNC_POLL_MS = 5_000L
private const val IDLE_SYNC_POLL_MS = 12_000L
private const val ACTIVE_SYNC_BURST_MS = 8_000L
private const val SYNC_TRIGGER_DEBOUNCE_MS = 250L
private const val OLDER_HISTORY_REQUEST_TIMEOUT_MS = 6_000L

data class ConversationItem(
    val id: String,
    val title: String,
    val updatedAt: Long,
    val isActive: Boolean
)

data class ChatUiState(
    val messages: List<Message> = emptyList(),
    val inputText: String = "",
    val pendingAttachments: List<MessageAttachment> = emptyList(),
    val downloadingAttachmentIds: Set<String> = emptySet(),
    val isConnected: Boolean = false,
    val isSending: Boolean = false,
    val isLoadingOlder: Boolean = false,
    val hasMoreHistory: Boolean = false,
    val isSwitchingConversation: Boolean = false,
    val projectId: String = "",
    val projectName: String = "",
    val agentId: String = "",
    val cliProvider: String = "claude",
    val cliModel: String = "",
    val isAgentOnline: Boolean = true,
    val isRunning: Boolean = false,
    val queuedCount: Int = 0,
    val currentPrompt: String? = null,
    val queuePreview: String? = null,
    val currentStartedAt: Long? = null,
    val activeConversationId: String? = null,
    val activeConversationTitle: String? = null,
    val conversations: List<ConversationItem> = emptyList()
)

class ChatViewModel(
    private val messageRepository: MessageRepository,
    private val webSocket: RelayWebSocket,
    private val tokenStore: TokenStore
) : ViewModel() {
    private data class PendingOlderHistoryRequest(
        val previousFirstMessageId: String?,
        val previousSize: Int,
        val previousEarliestSyncSeq: Long,
        val visibleMessageCount: Int,
        val autoTriggered: Boolean
    )

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private val json = Json { ignoreUnknownKeys = true }
    private var messagesJob: Job? = null
    private var sessionJob: Job? = null
    private var allMessages: List<Message> = emptyList()
    private var visibleMessageCount: Int = MESSAGE_PAGE_SIZE
    private var isAutoLoadingConversationHistory = false
    private var activeSyncJob: Job? = null
    private var pendingSyncTriggerJob: Job? = null
    private var olderHistoryTimeoutJob: Job? = null
    private var pendingOlderHistoryRequest: PendingOlderHistoryRequest? = null
    private var syncBurstUntilMillis: Long = 0L

    init {
        viewModelScope.launch {
            webSocket.connectionState.collect { state ->
                val isConnected = state == RelayWebSocket.ConnectionState.CONNECTED
                _uiState.update {
                    it.copy(isConnected = isConnected)
                }

                if (isConnected) {
                    markSyncBurst()
                    triggerImmediateSync(
                        debounceMs = 0L,
                        recentOverlapCount = ACTIVE_SYNC_OVERLAP_COUNT,
                        limit = INITIAL_SYNC_PAGE_SIZE
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
                val activeProjectId = state.projectId.trim()
                if (activeProjectId.isEmpty()) {
                    return@collect
                }

                val envelopeProjectId = envelope.projectId?.trim().orEmpty()
                if (envelopeProjectId == activeProjectId) {
                    when (envelope.event) {
                        Events.MESSAGE_DONE,
                        Events.MESSAGE_ERROR,
                        Events.AGENT_STATUS,
                        Events.FILE_DONE,
                        Events.FILE_ERROR -> {
                            triggerImmediateSync(
                                recentOverlapCount = ACTIVE_SYNC_OVERLAP_COUNT,
                                limit = INCREMENTAL_SYNC_PAGE_SIZE
                            )
                        }
                    }
                    return@collect
                }

                if (envelope.event == Events.PROJECT_LISTED) {
                    val payloadAgentId = runCatching {
                        envelope.payload
                            ?.jsonObject
                            ?.get("agent_id")
                            ?.jsonPrimitive
                            ?.contentOrNull
                            ?.trim()
                    }.getOrNull().orEmpty()
                    if (payloadAgentId.isNotEmpty() && payloadAgentId == state.agentId.trim()) {
                        triggerImmediateSync(
                            recentOverlapCount = ACTIVE_SYNC_OVERLAP_COUNT / 2,
                            limit = INCREMENTAL_SYNC_PAGE_SIZE
                        )
                    }
                }
            }
        }
    }

    fun loadProject(projectId: String, projectName: String, agentId: String) {
        if (projectId.isEmpty()) {
            CrashLogger.logError("ChatViewModel", "loadProject called with empty projectId")
            return
        }

        visibleMessageCount = MESSAGE_PAGE_SIZE
        allMessages = emptyList()
        isAutoLoadingConversationHistory = false
        olderHistoryTimeoutJob?.cancel()
        olderHistoryTimeoutJob = null
        pendingOlderHistoryRequest = null
        _uiState.update {
            it.copy(
                projectId = projectId,
                projectName = projectName,
                agentId = agentId,
                inputText = tokenStore.getDraft(projectId),
                pendingAttachments = emptyList(),
                downloadingAttachmentIds = emptySet(),
                isLoadingOlder = false,
                hasMoreHistory = false,
                isSwitchingConversation = false,
                messages = emptyList()
            )
        }
        markSyncBurst()
        startActiveSyncLoop()

        sessionJob?.cancel()
        sessionJob = viewModelScope.launch {
            try {
                messageRepository.getSessionForProject(projectId).collect { session ->
                    _uiState.update { current ->
                        current.copy(
                            projectName = session?.name?.ifBlank { current.projectName } ?: current.projectName,
                            agentId = session?.agentId?.ifBlank { current.agentId } ?: current.agentId,
                            cliProvider = session?.cliProvider?.ifBlank { "claude" } ?: current.cliProvider,
                            cliModel = session?.cliModel?.orEmpty() ?: "",
                            isAgentOnline = session?.isAgentOnline ?: current.isAgentOnline,
                            isRunning = session?.isRunning ?: false,
                            queuedCount = session?.queuedCount ?: 0,
                            currentPrompt = session?.currentPrompt,
                            queuePreview = session?.queuePreview,
                            currentStartedAt = session?.currentStartedAt,
                            activeConversationId = session?.activeConversationId,
                            activeConversationTitle = session?.activeConversationTitle,
                            conversations = parseConversationItems(
                                session?.conversationsJson,
                                session?.activeConversationId
                            ),
                            isSwitchingConversation = false
                        )
                    }
                    if ((session?.isRunning == true) || (session?.queuedCount ?: 0) > 0) {
                        markSyncBurst()
                    }
                }
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error collecting session metadata", e)
            }
        }

        messagesJob?.cancel()
        messagesJob = viewModelScope.launch {
            try {
                messageRepository.getConversationMessagesForProject(projectId).collect { messages ->
                    val previousMessages = allMessages
                    allMessages = messages
                    reconcilePendingOlderHistory(previousMessages, messages)
                    publishVisibleMessages()
                    maybeLoadMoreConversationHistory()
                }
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error collecting messages", e)
            }
        }

        triggerImmediateSync(
            debounceMs = 0L,
            recentOverlapCount = ACTIVE_SYNC_OVERLAP_COUNT,
            limit = INITIAL_SYNC_PAGE_SIZE
        )
    }

    private fun requestProjectSyncIfConnected(
        recentOverlapCount: Int = ACTIVE_SYNC_OVERLAP_COUNT,
        limit: Int = INCREMENTAL_SYNC_PAGE_SIZE
    ) {
        val state = _uiState.value
        if (state.projectId.isBlank()) {
            return
        }
        if (webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED) {
            return
        }

        viewModelScope.launch {
            try {
                messageRepository.requestProjectSync(
                    projectId = state.projectId,
                    agentId = state.agentId,
                    limit = limit,
                    recentOverlapCount = recentOverlapCount
                )
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error requesting desktop sync", e)
            }
        }
    }

    fun loadOlderMessages() {
        val state = _uiState.value
        if (state.projectId.isBlank() || state.isLoadingOlder) {
            return
        }

        if (visibleMessageCount < allMessages.size) {
            visibleMessageCount += MESSAGE_PAGE_SIZE
            publishVisibleMessages()
            maybeLoadMoreConversationHistory()
            return
        }

        val earliestSyncSeq = allMessages
            .mapNotNull { message -> message.syncSeq.takeIf { it > 0L } }
            .minOrNull()
            ?: 0L
        if (earliestSyncSeq <= 1L || webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED) {
            _uiState.update { it.copy(hasMoreHistory = false) }
            return
        }

        requestOlderMessages(earliestSyncSeq, state.projectId, state.agentId)
    }

    fun createConversation() {
        val state = _uiState.value
        if (state.projectId.isBlank() || state.isRunning || state.queuedCount > 0 || state.isSwitchingConversation) {
            return
        }

        _uiState.update { it.copy(isSwitchingConversation = true) }
        viewModelScope.launch {
            try {
                visibleMessageCount = MESSAGE_PAGE_SIZE
                allMessages = emptyList()
                pendingOlderHistoryRequest = null
                olderHistoryTimeoutJob?.cancel()
                olderHistoryTimeoutJob = null
                messageRepository.clearProjectLocalMessages(state.projectId)
                messageRepository.createNewConversation(state.projectId, state.agentId)
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error creating conversation", e)
                _uiState.update { it.copy(isSwitchingConversation = false) }
            }
        }
    }

    fun switchConversation(conversationId: String) {
        val state = _uiState.value
        if (state.projectId.isBlank() || conversationId.isBlank()) {
            return
        }
        if (state.isRunning || state.queuedCount > 0 || state.isSwitchingConversation) {
            return
        }
        if (conversationId == state.activeConversationId) {
            return
        }

        _uiState.update { it.copy(isSwitchingConversation = true) }
        viewModelScope.launch {
            try {
                visibleMessageCount = MESSAGE_PAGE_SIZE
                allMessages = emptyList()
                pendingOlderHistoryRequest = null
                olderHistoryTimeoutJob?.cancel()
                olderHistoryTimeoutJob = null
                messageRepository.clearProjectLocalMessages(state.projectId)
                messageRepository.switchConversation(state.projectId, state.agentId, conversationId)
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error switching conversation", e)
                _uiState.update { it.copy(isSwitchingConversation = false) }
            }
        }
    }

    fun updateInput(text: String) {
        val projectId = _uiState.value.projectId
        if (projectId.isNotBlank()) {
            tokenStore.saveDraft(projectId, text)
        }
        _uiState.update { it.copy(inputText = text) }
    }

    fun addAttachments(uris: List<Uri>) {
        val state = _uiState.value
        if (state.projectId.isBlank() || uris.isEmpty() || state.isSending) {
            return
        }

        _uiState.update { it.copy(isSending = true) }
        viewModelScope.launch {
            try {
                val prepared = messageRepository.preparePendingAttachments(state.projectId, uris)
                _uiState.update { current ->
                    current.copy(
                        pendingAttachments = mergeAttachments(current.pendingAttachments, prepared),
                        isSending = false
                    )
                }
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error preparing attachments", e)
                _uiState.update { it.copy(isSending = false) }
            }
        }
    }

    fun removePendingAttachment(attachmentId: String) {
        _uiState.update { state ->
            state.copy(
                pendingAttachments = state.pendingAttachments.filterNot { it.id == attachmentId }
            )
        }
    }

    fun sendMessage() {
        val state = _uiState.value
        if (state.projectId.isBlank() || state.isSending) {
            return
        }

        val textSnapshot = state.inputText
        val attachmentSnapshot = state.pendingAttachments
        if (textSnapshot.trim().isEmpty() && attachmentSnapshot.isEmpty()) {
            return
        }
        val optimisticPrompt = buildOptimisticPromptPreview(textSnapshot, attachmentSnapshot)
        val optimisticStartedAt = System.currentTimeMillis()

        tokenStore.clearDraft(state.projectId)
        markSyncBurst()
        _uiState.update {
            it.copy(
                inputText = "",
                pendingAttachments = emptyList(),
                isSending = true,
                isRunning = if (state.isRunning || state.queuedCount > 0) state.isRunning else true,
                queuedCount = if (state.isRunning || state.queuedCount > 0) state.queuedCount + 1 else 0,
                currentPrompt = if (state.isRunning || state.queuedCount > 0) state.currentPrompt else optimisticPrompt,
                queuePreview = if (state.isRunning || state.queuedCount > 0) optimisticPrompt else null,
                currentStartedAt = if (state.isRunning || state.queuedCount > 0) state.currentStartedAt else optimisticStartedAt
            )
        }

        viewModelScope.launch {
            try {
                messageRepository.sendMessage(
                    projectId = state.projectId,
                    content = textSnapshot,
                    attachments = attachmentSnapshot,
                    agentId = state.agentId
                )
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error sending message", e)
                tokenStore.saveDraft(state.projectId, textSnapshot)
                _uiState.update {
                    it.copy(
                        inputText = textSnapshot,
                        pendingAttachments = attachmentSnapshot,
                        isRunning = state.isRunning,
                        queuedCount = state.queuedCount,
                        currentPrompt = state.currentPrompt,
                        queuePreview = state.queuePreview,
                        currentStartedAt = state.currentStartedAt
                    )
                }
            } finally {
                _uiState.update { it.copy(isSending = false) }
            }
        }
    }

    private fun buildOptimisticPromptPreview(
        content: String,
        attachments: List<MessageAttachment>
    ): String {
        val trimmed = content.trim()
        if (trimmed.isNotEmpty()) {
            return content
        }
        if (attachments.size == 1) {
            return attachments.first().name.ifBlank { "Attachment" }
        }
        if (attachments.isNotEmpty()) {
            return "${attachments.size} attachments"
        }
        return ""
    }

    fun stopTask() {
        val state = _uiState.value
        if (state.projectId.isBlank() || !state.isRunning) return
        markSyncBurst()
        viewModelScope.launch {
            try {
                messageRepository.sendStopTask(state.projectId, state.agentId)
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error sending stop task", e)
            }
        }
    }

    fun clearInput() {
        val projectId = _uiState.value.projectId
        if (projectId.isNotBlank()) {
            tokenStore.clearDraft(projectId)
        }
        _uiState.update { it.copy(inputText = "") }
    }

    fun changeModel(rawModel: String) {
        val state = _uiState.value
        if (state.projectId.isBlank() || state.isSending) {
            return
        }

        val normalized = rawModel.trim()
        val command = if (normalized.isBlank()) "/model auto" else "/model $normalized"

        _uiState.update { it.copy(isSending = true) }
        viewModelScope.launch {
            try {
                messageRepository.sendMessage(state.projectId, command, emptyList(), state.agentId)
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error changing model", e)
            } finally {
                _uiState.update { it.copy(isSending = false) }
            }
        }
    }

    fun downloadAttachment(messageId: String, attachment: MessageAttachment) {
        val state = _uiState.value
        if (state.projectId.isBlank() || attachment.id.isBlank()) {
            return
        }
        if (attachment.localUri?.isNotBlank() == true) {
            return
        }
        if (attachment.id in state.downloadingAttachmentIds) {
            return
        }

        _uiState.update {
            it.copy(downloadingAttachmentIds = it.downloadingAttachmentIds + attachment.id)
        }

        viewModelScope.launch {
            try {
                messageRepository.downloadAttachment(
                    projectId = state.projectId,
                    messageId = messageId,
                    attachment = attachment,
                    agentId = state.agentId
                )
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error downloading attachment", e)
            } finally {
                _uiState.update {
                    it.copy(downloadingAttachmentIds = it.downloadingAttachmentIds - attachment.id)
                }
            }
        }
    }

    private fun publishVisibleMessages() {
        val startIndex = (allMessages.size - visibleMessageCount).coerceAtLeast(0)
        val visibleMessages = allMessages.drop(startIndex)
        val earliestSyncSeq = allMessages
            .mapNotNull { message -> message.syncSeq.takeIf { it > 0L } }
            .minOrNull()
            ?: 0L

        _uiState.update {
            it.copy(
                messages = visibleMessages,
                hasMoreHistory = startIndex > 0 || earliestSyncSeq > 1L
            )
        }
    }

    private fun maybeLoadMoreConversationHistory() {
        val state = _uiState.value
        if (state.projectId.isBlank() || state.isLoadingOlder || state.isSwitchingConversation) {
            return
        }
        if (webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED) {
            return
        }
        if (isAutoLoadingConversationHistory) {
            return
        }

        if (allMessages.size >= visibleMessageCount) {
            return
        }

        val earliestSyncSeq = allMessages
            .mapNotNull { message -> message.syncSeq.takeIf { it > 0L } }
            .minOrNull()
            ?: 0L
        if (earliestSyncSeq <= 1L) {
            return
        }

        requestOlderMessages(
            beforeSeq = earliestSyncSeq,
            projectId = state.projectId,
            agentId = state.agentId,
            autoTriggered = true
        )
    }

    private fun requestOlderMessages(
        beforeSeq: Long,
        projectId: String,
        agentId: String,
        autoTriggered: Boolean = false
    ) {
        pendingOlderHistoryRequest = PendingOlderHistoryRequest(
            previousFirstMessageId = allMessages.firstOrNull()?.id,
            previousSize = allMessages.size,
            previousEarliestSyncSeq = allMessages.earliestSyncSeq(),
            visibleMessageCount = visibleMessageCount,
            autoTriggered = autoTriggered
        )
        _uiState.update { it.copy(isLoadingOlder = true) }
        if (autoTriggered) {
            isAutoLoadingConversationHistory = true
        }
        olderHistoryTimeoutJob?.cancel()
        olderHistoryTimeoutJob = viewModelScope.launch {
            kotlinx.coroutines.delay(OLDER_HISTORY_REQUEST_TIMEOUT_MS)
            if (pendingOlderHistoryRequest?.previousEarliestSyncSeq == beforeSeq) {
                clearPendingOlderHistory()
            }
        }
        viewModelScope.launch {
            try {
                messageRepository.loadOlderProjectMessages(
                    projectId = projectId,
                    agentId = agentId,
                    beforeSeq = beforeSeq,
                    limit = INITIAL_SYNC_PAGE_SIZE
                )
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error loading older messages", e)
                clearPendingOlderHistory()
            }
        }
    }

    private fun reconcilePendingOlderHistory(
        previousMessages: List<Message>,
        nextMessages: List<Message>
    ) {
        val pending = pendingOlderHistoryRequest ?: return
        val prependedCount = calculatePrependedMessageCount(
            previousFirstMessageId = pending.previousFirstMessageId,
            previousMessages = previousMessages,
            nextMessages = nextMessages
        )
        val nextEarliestSyncSeq = nextMessages.earliestSyncSeq()
        val olderHistoryArrived = prependedCount > 0 ||
            (
                pending.previousEarliestSyncSeq > 0L &&
                    nextEarliestSyncSeq > 0L &&
                    nextEarliestSyncSeq < pending.previousEarliestSyncSeq
                )
        if (!olderHistoryArrived) {
            return
        }

        visibleMessageCount = maxOf(
            pending.visibleMessageCount + prependedCount,
            visibleMessageCount + prependedCount
        )
        clearPendingOlderHistory()
    }

    private fun clearPendingOlderHistory() {
        if (pendingOlderHistoryRequest?.autoTriggered == true) {
            isAutoLoadingConversationHistory = false
        }
        pendingOlderHistoryRequest = null
        olderHistoryTimeoutJob?.cancel()
        olderHistoryTimeoutJob = null
        _uiState.update { it.copy(isLoadingOlder = false) }
    }

    private fun calculatePrependedMessageCount(
        previousFirstMessageId: String?,
        previousMessages: List<Message>,
        nextMessages: List<Message>
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

    private fun List<Message>.earliestSyncSeq(): Long =
        mapNotNull { message -> message.syncSeq.takeIf { it > 0L } }
            .minOrNull()
            ?: 0L

    private fun startActiveSyncLoop() {
        val projectId = _uiState.value.projectId
        if (projectId.isBlank()) {
            return
        }
        activeSyncJob?.cancel()
        activeSyncJob = viewModelScope.launch {
            while (true) {
                val state = _uiState.value
                if (state.projectId.isBlank()) {
                    break
                }
                if (webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED) {
                    val now = System.currentTimeMillis()
                    val shouldAggressivelySync = state.isRunning ||
                        state.isSending ||
                        state.messages.lastOrNull()?.isStreaming == true ||
                        now < syncBurstUntilMillis
                    requestProjectSyncIfConnected(
                        recentOverlapCount = if (shouldAggressivelySync) {
                            ACTIVE_SYNC_OVERLAP_COUNT
                        } else {
                            ACTIVE_SYNC_OVERLAP_COUNT / 2
                        },
                        limit = if (shouldAggressivelySync) {
                            INCREMENTAL_SYNC_PAGE_SIZE
                        } else {
                            MESSAGE_PAGE_SIZE
                        }
                    )
                    kotlinx.coroutines.delay(
                        if (shouldAggressivelySync) ACTIVE_SYNC_POLL_MS else IDLE_SYNC_POLL_MS
                    )
                } else {
                    kotlinx.coroutines.delay(IDLE_SYNC_POLL_MS)
                }
            }
        }
    }

    private fun markSyncBurst(durationMs: Long = ACTIVE_SYNC_BURST_MS) {
        syncBurstUntilMillis = System.currentTimeMillis() + durationMs
    }

    private fun triggerImmediateSync(
        debounceMs: Long = SYNC_TRIGGER_DEBOUNCE_MS,
        recentOverlapCount: Int = ACTIVE_SYNC_OVERLAP_COUNT,
        limit: Int = INCREMENTAL_SYNC_PAGE_SIZE
    ) {
        markSyncBurst()
        pendingSyncTriggerJob?.cancel()
        pendingSyncTriggerJob = viewModelScope.launch {
            if (debounceMs > 0L) {
                kotlinx.coroutines.delay(debounceMs)
            }
            requestProjectSyncIfConnected(
                recentOverlapCount = recentOverlapCount,
                limit = limit
            )
        }
    }

    override fun onCleared() {
        activeSyncJob?.cancel()
        pendingSyncTriggerJob?.cancel()
        olderHistoryTimeoutJob?.cancel()
        super.onCleared()
    }

    private fun parseConversationItems(
        rawJson: String?,
        activeConversationId: String?
    ): List<ConversationItem> {
        if (rawJson.isNullOrBlank()) {
            return emptyList()
        }

        return runCatching {
            json.parseToJsonElement(rawJson)
                .jsonArray
                .mapNotNull { item ->
                    val itemObj = item.jsonObject
                    val id = itemObj["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                    if (id.isBlank()) {
                        return@mapNotNull null
                    }
                    ConversationItem(
                        id = id,
                        title = itemObj["title"]?.jsonPrimitive?.contentOrNull?.trim()
                            .takeUnless { it.isNullOrBlank() }
                            ?: "New conversation",
                        updatedAt = itemObj["updated_at"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: 0L,
                        isActive = id == activeConversationId
                    )
                }
                .sortedByDescending { it.updatedAt }
        }.getOrElse { error ->
            CrashLogger.logError("ChatViewModel", "Failed to parse conversation list", error as? Exception ?: Exception(error))
            emptyList()
        }
    }

    private fun mergeAttachments(
        current: List<MessageAttachment>,
        incoming: List<MessageAttachment>
    ): List<MessageAttachment> {
        if (incoming.isEmpty()) {
            return current
        }

        val merged = current.toMutableList()
        val existingKeys = current.map { attachmentKey(it) }.toMutableSet()
        incoming.forEach { attachment ->
            val key = attachmentKey(attachment)
            if (key !in existingKeys) {
                merged += attachment
                existingKeys += key
            }
        }
        return merged
    }

    private fun attachmentKey(attachment: MessageAttachment): String =
        buildString {
            append(attachment.id.ifBlank { attachment.name })
            append('|')
            append(attachment.size)
            append('|')
            append(attachment.localUri ?: attachment.filePath.orEmpty())
        }
}
