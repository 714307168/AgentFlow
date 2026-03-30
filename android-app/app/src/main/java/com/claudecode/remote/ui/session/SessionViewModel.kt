package com.claudecode.remote.ui.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.AgentWorkgroups
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.MessageRepository
import com.claudecode.remote.domain.SessionRepository
import com.claudecode.remote.domain.WorkgroupRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

data class SessionUiState(
    val sessions: List<Session> = emptyList(),
    val agentWorkgroups: List<AgentWorkgroups> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val collapsedGroupKeys: Set<String> = emptySet()
)

class SessionViewModel(
    private val repository: SessionRepository,
    private val messageRepository: MessageRepository,
    private val webSocket: RelayWebSocket,
    private val tokenStore: TokenStore,
    private val workgroupRepository: WorkgroupRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SessionUiState())
    val uiState: StateFlow<SessionUiState> = _uiState.asStateFlow()

    val sessions = repository.sessions

    init {
        _uiState.update { it.copy(collapsedGroupKeys = tokenStore.getCollapsedSessionGroups()) }
        viewModelScope.launch {
            repository.sessions.collect { sessions ->
                _uiState.update {
                    it.copy(
                        sessions = sessions.sortedWith(
                            compareByDescending<Session> { session -> session.lastActiveAt }
                                .thenBy { session -> session.name.lowercase() }
                        )
                    )
                }
            }
        }
        viewModelScope.launch {
            workgroupRepository.agentWorkgroups.collect { groups ->
                _uiState.update { it.copy(agentWorkgroups = groups) }
            }
        }
        viewModelScope.launch {
            repository.sessions
                .map { sessions ->
                    sessions
                        .map { it.agentId.trim() }
                        .filter { it.isNotEmpty() }
                        .distinct()
                        .sorted()
                }
                .distinctUntilChanged()
                .collect { agentIds ->
                    workgroupRepository.retainAgentIds(agentIds)
                    if (agentIds.isNotEmpty() && webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED) {
                        workgroupRepository.refresh(agentIds)
                    }
                }
        }
        viewModelScope.launch {
            webSocket.connectionState.collect { state ->
                if (state == RelayWebSocket.ConnectionState.CONNECTED) {
                    refreshWorkgroups(showLoading = false)
                }
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
                onSuccess = {
                    refreshWorkgroups(showLoading = false)
                    _uiState.update { it.copy(isLoading = false) }
                },
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
            repository.syncFromServer(force = true).fold(
                onSuccess = {
                    if (webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED) {
                        messageRepository.requestProjectSyncs(repository.getSessions())
                        refreshWorkgroups(showLoading = false)
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

    fun toggleGroupCollapsed(groupKey: String) {
        if (groupKey.isBlank()) {
            return
        }
        _uiState.update { current ->
            val nextCollapsed = current.collapsedGroupKeys.toMutableSet().apply {
                if (!add(groupKey)) {
                    remove(groupKey)
                }
            }.toSet()
            tokenStore.saveCollapsedSessionGroups(nextCollapsed)
            current.copy(collapsedGroupKeys = nextCollapsed)
        }
    }

    private suspend fun refreshWorkgroups(showLoading: Boolean) {
        val agentIds = repository.getSessions()
            .map { it.agentId.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .sorted()
        if (agentIds.isEmpty() || webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED) {
            workgroupRepository.retainAgentIds(agentIds)
            return
        }
        if (showLoading) {
            _uiState.update { it.copy(isLoading = true) }
        }
        workgroupRepository.refresh(agentIds)
    }
}
