package com.claudecode.remote.ui.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.MessageRepository
import com.claudecode.remote.domain.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

data class SessionUiState(
    val sessions: List<Session> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class SessionViewModel(
    private val repository: SessionRepository,
    private val messageRepository: MessageRepository,
    private val webSocket: RelayWebSocket
) : ViewModel() {

    private val _uiState = MutableStateFlow(SessionUiState())
    val uiState: StateFlow<SessionUiState> = _uiState.asStateFlow()

    val sessions = repository.sessions

    init {
        viewModelScope.launch {
            repository.sessions.collect { sessions ->
                _uiState.update { it.copy(sessions = sessions) }
            }
        }
    }

    fun initialize() {
        _uiState.update { current ->
            current.copy(
                isLoading = current.sessions.isEmpty()
            )
        }
        viewModelScope.launch {
            repository.initialize().fold(
                onSuccess = { _uiState.update { it.copy(isLoading = false) } },
                onFailure = { e -> _uiState.update { it.copy(isLoading = false, error = e.message) } }
            )
        }
    }

    fun syncFromDesktop() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            if (webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED) {
                webSocket.send(
                    Envelope(
                        id = UUID.randomUUID().toString(),
                        event = Events.PROJECT_LIST_REQUEST,
                        ts = System.currentTimeMillis()
                    )
                )
                delay(400)
            }
            repository.syncFromServer().fold(
                onSuccess = {
                    if (webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED) {
                        messageRepository.requestProjectSyncs(repository.getSessions())
                    }
                    _uiState.update { it.copy(isLoading = false) }
                },
                onFailure = { e -> _uiState.update { it.copy(isLoading = false, error = e.message) } }
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
