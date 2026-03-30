package com.claudecode.remote.ui.agent

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.R
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.AgentWorkgroups
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.model.WorkgroupRegistryEntry
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.MessageRepository
import com.claudecode.remote.domain.SessionRepository
import com.claudecode.remote.domain.WorkgroupRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

data class AgentHubUiState(
    val sessions: List<Session> = emptyList(),
    val agentWorkgroups: List<AgentWorkgroups> = emptyList(),
    val registryQuery: String = "",
    val registryResults: List<WorkgroupRegistryEntry> = emptyList(),
    val isSearchingRegistry: Boolean = false,
    val joiningGroupNumber: String? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
    val collapsedGroupKeys: Set<String> = emptySet()
)

class AgentHubViewModel(
    private val context: Context,
    private val sessionRepository: SessionRepository,
    private val messageRepository: MessageRepository,
    private val workgroupRepository: WorkgroupRepository,
    private val webSocket: RelayWebSocket,
    private val tokenStore: TokenStore
) : ViewModel() {
    private val _uiState = MutableStateFlow(
        AgentHubUiState(
            collapsedGroupKeys = tokenStore.getCollapsedAgentGroups()
        )
    )
    val uiState: StateFlow<AgentHubUiState> = _uiState.asStateFlow()

    private var initialized = false
    private var latestAgentIds: List<String> = emptyList()

    private fun text(resId: Int, vararg args: Any): String = context.getString(resId, *args)

    init {
        viewModelScope.launch {
            sessionRepository.sessions.collect { sessions ->
                _uiState.update { it.copy(sessions = sessions) }
            }
        }

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
                        .map { session -> session.agentId.trim() }
                        .filter { agentId -> agentId.isNotEmpty() }
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
            _uiState.update { it.copy(isLoading = true, error = null) }
            if (webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED) {
                webSocket.sendProjectListRequest()
                delay(400)
            }
            sessionRepository.syncFromServer(force = true)
                .onFailure { error ->
                    _uiState.update { it.copy(isLoading = false, error = error.message) }
                    return@launch
                }

            if (isConnected()) {
                messageRepository.requestProjectSyncs(sessionRepository.getSessions())
            }

            val agentIds = resolveAgentIds()
            latestAgentIds = agentIds
            if (agentIds.isEmpty() || !isConnected()) {
                _uiState.update { it.copy(isLoading = false) }
                return@launch
            }
            requestWorkgroups(agentIds, showLoading = false, force = true)
            _uiState.update { it.copy(isLoading = false) }
        }
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
            tokenStore.saveCollapsedAgentGroups(nextCollapsed)
            current.copy(collapsedGroupKeys = nextCollapsed)
        }
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
                        requestWorkgroups(
                            latestAgentIds,
                            showLoading = uiState.value.agentWorkgroups.isEmpty(),
                            force = true
                        )
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

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun isConnected(): Boolean = webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED

    private suspend fun resolveAgentIds(): List<String> {
        return workgroupRepository.resolveTrackedAgentIds(
            sessionRepository.getSessions()
                .map { session -> session.agentId.trim() }
                .filter { agentId -> agentId.isNotEmpty() }
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

private fun RelayWebSocket.sendProjectListRequest() {
    send(
        com.claudecode.remote.data.model.Envelope(
            id = UUID.randomUUID().toString(),
            event = com.claudecode.remote.data.model.Events.PROJECT_LIST_REQUEST,
            ts = System.currentTimeMillis()
        )
    )
}
