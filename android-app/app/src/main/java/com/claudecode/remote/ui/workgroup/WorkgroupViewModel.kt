package com.claudecode.remote.ui.workgroup

import android.content.Context
import com.claudecode.remote.R
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.model.AgentWorkgroups
import com.claudecode.remote.data.model.WorkgroupRegistryEntry
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
    val registryQuery: String = "",
    val registryResults: List<WorkgroupRegistryEntry> = emptyList(),
    val isSearchingRegistry: Boolean = false,
    val joiningGroupNumber: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

class WorkgroupViewModel(
    private val context: Context,
    private val sessionRepository: SessionRepository,
    private val workgroupRepository: WorkgroupRepository,
    private val webSocket: RelayWebSocket
) : ViewModel() {
    private val _uiState = MutableStateFlow(WorkgroupUiState())
    val uiState: StateFlow<WorkgroupUiState> = _uiState.asStateFlow()

    private var initialized = false
    private var latestAgentIds: List<String> = emptyList()

    private fun text(resId: Int, vararg args: Any): String = context.getString(resId, *args)

    init {
        viewModelScope.launch {
            workgroupRepository.agentWorkgroups.collect { groups ->
                _uiState.update { it.copy(agentWorkgroups = groups, isLoading = false) }
            }
        }

        viewModelScope.launch {
            workgroupRepository.registryResults.collect { results ->
                _uiState.update { it.copy(registryResults = results, isSearchingRegistry = false) }
            }
        }

        viewModelScope.launch {
            sessionRepository.sessions
                .map { sessions ->
                    sessions
                        .map { it.agentId.trim() }
                        .filter { it.isNotEmpty() }
                        .let(workgroupRepository::resolveTrackedAgentIds)
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
            requestWorkgroups(agentIds, showLoading = true, force = true)
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun updateRegistryQuery(query: String) {
        _uiState.update { current ->
            current.copy(
                registryQuery = query,
                registryResults = if (query.isBlank()) emptyList() else current.registryResults
            )
        }
    }

    fun searchRegistry() {
        val query = uiState.value.registryQuery.trim()
        if (query.isEmpty()) {
            _uiState.update { it.copy(registryResults = emptyList(), isSearchingRegistry = false) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSearchingRegistry = true, error = null) }
            workgroupRepository.searchRegistry(query)
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            isSearchingRegistry = false,
                            error = error.message ?: text(R.string.workgroups_error_search)
                        )
                    }
                }
        }
    }

    fun joinWorkgroup(groupNumber: String) {
        val normalizedGroupNumber = groupNumber.trim()
        if (normalizedGroupNumber.isEmpty()) {
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(joiningGroupNumber = normalizedGroupNumber, error = null) }
            workgroupRepository.joinRegistry(normalizedGroupNumber)
                .onSuccess { entry ->
                    latestAgentIds = workgroupRepository.resolveTrackedAgentIds(latestAgentIds + entry.hostAgentId)
                    _uiState.update {
                        it.copy(
                            joiningGroupNumber = null,
                            registryQuery = entry.groupNumber,
                            error = null
                        )
                    }
                    if (isConnected()) {
                        requestWorkgroups(latestAgentIds, showLoading = uiState.value.agentWorkgroups.isEmpty(), force = true)
                    }
                }
                .onFailure { error ->
                    _uiState.update {
                        it.copy(
                            joiningGroupNumber = null,
                            error = error.message ?: text(R.string.workgroups_error_join)
                        )
                    }
                }
        }
    }

    fun isConnected(): Boolean = webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED

    private suspend fun resolveAgentIds(forceSyncIfEmpty: Boolean): List<String> {
        var sessions = sessionRepository.getSessions()
        if (forceSyncIfEmpty && sessions.isEmpty()) {
            sessionRepository.syncFromServer(force = true)
            sessions = sessionRepository.getSessions()
        }
        return workgroupRepository.resolveTrackedAgentIds(
            sessions
            .map { it.agentId.trim() }
            .filter { it.isNotEmpty() }
        )
    }

    private suspend fun requestWorkgroups(
        agentIds: List<String>,
        showLoading: Boolean,
        force: Boolean = false
    ) {
        if (agentIds.isEmpty()) {
            return
        }
        _uiState.update { current ->
            current.copy(
                isLoading = showLoading,
                error = null
            )
        }
        workgroupRepository.refresh(agentIds, force = force)
    }
}
