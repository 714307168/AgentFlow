package com.claudecode.remote.ui.chat

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.model.Message
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
    private val webSocket: RelayWebSocket
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()
    private var messagesJob: Job? = null
    private var sessionJob: Job? = null
    private var lastSyncedProjectId: String? = null

    init {
        // Observe connection state
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
        CrashLogger.logInfo("ChatViewModel", "loadProject called: projectId=$projectId, projectName=$projectName, agentId=$agentId")

        if (projectId.isEmpty()) {
            CrashLogger.logError("ChatViewModel", "loadProject called with empty projectId")
            return
        }

        _uiState.update { it.copy(projectId = projectId, projectName = projectName, agentId = agentId) }
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
                CrashLogger.logInfo("ChatViewModel", "Starting to collect messages for project: $projectId")
                messageRepository.getMessagesForProject(projectId).collect { messages ->
                    CrashLogger.logInfo("ChatViewModel", "Received ${messages.size} messages")
                    _uiState.update { it.copy(messages = messages) }
                }
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error collecting messages", e)
                e.printStackTrace()
            }
        }

        requestProjectSyncIfConnected(force = true)

        // Don't reconnect if already connected
        viewModelScope.launch {
            try {
                val currentState = webSocket.connectionState.value
                CrashLogger.logInfo("ChatViewModel", "Current connection state: $currentState")

                if (currentState != RelayWebSocket.ConnectionState.CONNECTED) {
                    CrashLogger.logInfo("ChatViewModel", "Attempting to connect WebSocket")
                    webSocket.connect()
                } else {
                    CrashLogger.logInfo("ChatViewModel", "WebSocket already connected, skipping reconnect")
                }
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error connecting WebSocket", e)
                e.printStackTrace()
            }
        }
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
                CrashLogger.logInfo("ChatViewModel", "Requesting desktop sync for projectId=${state.projectId}")
                messageRepository.requestProjectSync(state.projectId, state.agentId)
            } catch (e: Exception) {
                lastSyncedProjectId = null
                CrashLogger.logError("ChatViewModel", "Error requesting desktop sync", e)
            }
        }
    }

    fun updateInput(text: String) {
        _uiState.update { it.copy(inputText = text) }
    }

    fun sendMessage() {
        val state = _uiState.value
        val content = state.inputText.trim()
        if (content.isEmpty() || state.isSending) return

        _uiState.update { it.copy(inputText = "", isSending = true) }
        viewModelScope.launch {
            try {
                CrashLogger.logInfo("ChatViewModel", "Sending message: projectId=${state.projectId}, content length=${content.length}")
                messageRepository.sendMessage(state.projectId, content, state.agentId)
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error sending message", e)
            } finally {
                _uiState.update { it.copy(isSending = false) }
            }
        }
    }

    fun sendFile(fileUri: Uri) {
        val state = _uiState.value
        if (state.isSending) return

        _uiState.update { it.copy(isSending = true) }
        viewModelScope.launch {
            try {
                CrashLogger.logInfo("ChatViewModel", "Sending file: projectId=${state.projectId}, uri=$fileUri")
                messageRepository.sendFile(state.projectId, fileUri, state.agentId)
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error sending file", e)
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
                CrashLogger.logInfo("ChatViewModel", "Changing model: projectId=${state.projectId}, model=${normalized.ifBlank { "auto" }}")
                messageRepository.sendMessage(state.projectId, command, state.agentId)
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error changing model", e)
            } finally {
                _uiState.update { it.copy(isSending = false) }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        // Don't disconnect WebSocket when leaving chat screen
        // It should stay connected for the session list
    }
}
