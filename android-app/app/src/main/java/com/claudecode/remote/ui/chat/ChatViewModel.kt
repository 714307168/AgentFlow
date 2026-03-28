package com.claudecode.remote.ui.chat

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.local.TokenStore
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
private const val MESSAGE_SYNC_PAGE_SIZE = 80

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

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private val json = Json { ignoreUnknownKeys = true }
    private var messagesJob: Job? = null
    private var sessionJob: Job? = null
    private var lastSyncedProjectId: String? = null
    private var allMessages: List<Message> = emptyList()
    private var visibleMessageCount: Int = MESSAGE_PAGE_SIZE
    private var isAutoLoadingConversationHistory = false

    init {
        viewModelScope.launch {
            webSocket.connectionState.collect { state ->
                val isConnected = state == RelayWebSocket.ConnectionState.CONNECTED
                _uiState.update {
                    it.copy(isConnected = isConnected)
                }

                if (isConnected) {
                    lastSyncedProjectId = null
                    requestProjectSyncIfConnected(force = true)
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
        lastSyncedProjectId = null

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
                }
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error collecting session metadata", e)
            }
        }

        messagesJob?.cancel()
        messagesJob = viewModelScope.launch {
            try {
                messageRepository.getConversationMessagesForProject(projectId).collect { messages ->
                    allMessages = messages
                    publishVisibleMessages()
                    maybeLoadMoreConversationHistory()
                }
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error collecting messages", e)
            }
        }

        requestProjectSyncIfConnected(force = true)
    }

    private fun requestProjectSyncIfConnected(force: Boolean = false) {
        val state = _uiState.value
        if (state.projectId.isBlank()) {
            return
        }
        if (webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED) {
            return
        }
        if (!force && lastSyncedProjectId == state.projectId) {
            return
        }

        viewModelScope.launch {
            try {
                lastSyncedProjectId = state.projectId
                messageRepository.requestProjectSync(
                    projectId = state.projectId,
                    agentId = state.agentId,
                    limit = MESSAGE_SYNC_PAGE_SIZE
                )
            } catch (e: Exception) {
                lastSyncedProjectId = null
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
        _uiState.update { it.copy(isLoadingOlder = true) }
        if (autoTriggered) {
            isAutoLoadingConversationHistory = true
        }
        viewModelScope.launch {
            try {
                messageRepository.loadOlderProjectMessages(
                    projectId = projectId,
                    agentId = agentId,
                    beforeSeq = beforeSeq,
                    limit = MESSAGE_SYNC_PAGE_SIZE
                )
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error loading older messages", e)
            } finally {
                if (autoTriggered) {
                    isAutoLoadingConversationHistory = false
                }
                _uiState.update { it.copy(isLoadingOlder = false) }
            }
        }
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
