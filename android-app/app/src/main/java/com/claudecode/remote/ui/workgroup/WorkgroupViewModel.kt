package com.claudecode.remote.ui.workgroup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.model.AgentWorkgroups
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.SessionRepository
import com.claudecode.remote.domain.WorkgroupRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WorkgroupUiState(
    val agentWorkgroups: List<AgentWorkgroups> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

class WorkgroupViewModel(
    private val sessionRepository: SessionRepository,
    private val workgroupRepository: WorkgroupRepository,
    private val webSocket: RelayWebSocket
) : ViewModel() {
    private val _uiState = MutableStateFlow(WorkgroupUiState())
    val uiState: StateFlow<WorkgroupUiState> = _uiState.asStateFlow()

    private var initialized = false
    private var latestAgentIds: List<String> = emptyList()

    init {
        viewModelScope.launch {
            workgroupRepository.agentWorkgroups.collect { groups ->
                _uiState.update { it.copy(agentWorkgroups = groups, isLoading = false) }
            }
        }

        viewModelScope.launch {
            sessionRepository.sessions
                .map { sessions ->
                    sessions
                        .map { it.agentId.trim() }
                        .filter { it.isNotEmpty() }
                        .distinct()
                        .sorted()
                }
                .distinctUntilChanged()
                .collect { agentIds ->
                    latestAgentIds = agentIds
                    if (initialized && agentIds.isNotEmpty() && isConnected()) {
                        requestWorkgroups(agentIds, showLoading = uiState.value.agentWorkgroups.isEmpty())
                    }
                }
        }

        viewModelScope.launch {
            webSocket.connectionState.collect { state ->
                if (initialized &&
                    state == RelayWebSocket.ConnectionState.CONNECTED &&
                    latestAgentIds.isNotEmpty()
                ) {
                    requestWorkgroups(latestAgentIds, showLoading = uiState.value.agentWorkgroups.isEmpty())
                }
            }
        }
    }

    fun initialize() {
        if (initialized) {
            return
        }
        initialized = true
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val agentIds = resolveAgentIds(forceSyncIfEmpty = true)
            latestAgentIds = agentIds
            if (agentIds.isEmpty()) {
                _uiState.update { it.copy(isLoading = false, error = null) }
                return@launch
            }
            if (!isConnected()) {
                _uiState.update { it.copy(isLoading = false, error = null) }
                return@launch
            }
            requestWorkgroups(agentIds, showLoading = true)
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun isConnected(): Boolean = webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED

    private suspend fun resolveAgentIds(forceSyncIfEmpty: Boolean): List<String> {
        var sessions = sessionRepository.getSessions()
        if (forceSyncIfEmpty && sessions.isEmpty()) {
            sessionRepository.syncFromServer()
            sessions = sessionRepository.getSessions()
        }
        return sessions
            .map { it.agentId.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .sorted()
    }

    private suspend fun requestWorkgroups(agentIds: List<String>, showLoading: Boolean) {
        if (agentIds.isEmpty()) {
            return
        }
        _uiState.update { current ->
            current.copy(
                isLoading = showLoading,
                error = null
            )
        }
        workgroupRepository.refresh(agentIds)
    }
}
