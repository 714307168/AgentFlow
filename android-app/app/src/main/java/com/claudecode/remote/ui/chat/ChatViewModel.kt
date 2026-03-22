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

data class ChatUiState(
    val messages: List<Message> = emptyList(),
    val inputText: String = "",
    val pendingAttachments: List<MessageAttachment> = emptyList(),
    val downloadingAttachmentIds: Set<String> = emptySet(),
    val isConnected: Boolean = false,
    val isSending: Boolean = false,
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
    val currentStartedAt: Long? = null
)

class ChatViewModel(
    private val messageRepository: MessageRepository,
    private val webSocket: RelayWebSocket,
    private val tokenStore: TokenStore
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()
    private var messagesJob: Job? = null
    private var sessionJob: Job? = null
    private var lastSyncedProjectId: String? = null

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

        _uiState.update {
            it.copy(
                projectId = projectId,
                projectName = projectName,
                agentId = agentId,
                inputText = tokenStore.getDraft(projectId),
                pendingAttachments = emptyList(),
                downloadingAttachmentIds = emptySet()
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
                            currentStartedAt = session?.currentStartedAt
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
                messageRepository.getMessagesForProject(projectId).collect { messages ->
                    _uiState.update { it.copy(messages = messages) }
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
                messageRepository.requestProjectSync(state.projectId, state.agentId)
            } catch (e: Exception) {
                lastSyncedProjectId = null
                CrashLogger.logError("ChatViewModel", "Error requesting desktop sync", e)
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

        tokenStore.clearDraft(state.projectId)
        _uiState.update {
            it.copy(
                inputText = "",
                pendingAttachments = emptyList(),
                isSending = true
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
                        pendingAttachments = attachmentSnapshot
                    )
                }
            } finally {
                _uiState.update { it.copy(isSending = false) }
            }
        }
    }

    fun stopTask() {
        val state = _uiState.value
        if (state.projectId.isBlank() || !state.isRunning) return
        viewModelScope.launch {
            try {
                messageRepository.sendStopTask(state.projectId)
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
