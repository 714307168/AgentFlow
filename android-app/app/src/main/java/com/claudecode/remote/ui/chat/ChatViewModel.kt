package com.claudecode.remote.ui.chat

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.MessageRepository
import com.claudecode.remote.util.CrashLogger
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
    val projectName: String = ""
)

class ChatViewModel(
    private val messageRepository: MessageRepository,
    private val webSocket: RelayWebSocket
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    init {
        // Observe connection state
        viewModelScope.launch {
            webSocket.connectionState.collect { state ->
                _uiState.update {
                    it.copy(isConnected = state == RelayWebSocket.ConnectionState.CONNECTED)
                }
            }
        }
        // Process incoming envelopes
        viewModelScope.launch {
            webSocket.incomingEnvelopes.collect { envelope ->
                messageRepository.processEnvelope(envelope)
            }
        }
    }

    fun loadProject(projectId: String, projectName: String) {
        CrashLogger.logInfo("ChatViewModel", "loadProject called: projectId=$projectId, projectName=$projectName")

        if (projectId.isEmpty()) {
            CrashLogger.logError("ChatViewModel", "loadProject called with empty projectId")
            return
        }

        _uiState.update { it.copy(projectId = projectId, projectName = projectName) }

        viewModelScope.launch {
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
                messageRepository.sendMessage(state.projectId, content)
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
                messageRepository.sendFile(state.projectId, fileUri)
            } catch (e: Exception) {
                CrashLogger.logError("ChatViewModel", "Error sending file", e)
            } finally {
                _uiState.update { it.copy(isSending = false) }
            }
        }
    }

    fun clearInput() {
        _uiState.update { it.copy(inputText = "") }
    }

    override fun onCleared() {
        super.onCleared()
        // Don't disconnect WebSocket when leaving chat screen
        // It should stay connected for the session list
    }
}
