package com.claudecode.remote.ui.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.domain.SessionRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SessionUiState(
    val sessions: List<Session> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val serverUrl: String = ""
)

class SessionViewModel(private val repository: SessionRepository) : ViewModel() {

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

    fun initialize(serverUrl: String) {
        _uiState.update { it.copy(serverUrl = serverUrl, isLoading = true) }
        viewModelScope.launch {
            repository.initialize().fold(
                onSuccess = { _uiState.update { it.copy(isLoading = false) } },
                onFailure = { e -> _uiState.update { it.copy(isLoading = false, error = e.message) } }
            )
        }
    }

    fun addSession(agentId: String, projectId: String, path: String, name: String) {
        _uiState.update { it.copy(isLoading = true) }
        viewModelScope.launch {
            repository.addSession(agentId, projectId, path, name).fold(
                onSuccess = { _uiState.update { it.copy(isLoading = false) } },
                onFailure = { e -> _uiState.update { it.copy(isLoading = false, error = e.message) } }
            )
        }
    }

    fun removeSession(id: String) {
        viewModelScope.launch {
            repository.removeSession(id)
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
