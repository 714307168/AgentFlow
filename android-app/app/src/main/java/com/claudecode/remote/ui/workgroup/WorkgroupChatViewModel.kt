package com.claudecode.remote.ui.workgroup

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.WorkgroupMember
import com.claudecode.remote.data.model.WorkgroupMessage
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.domain.WorkgroupRepository
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val WORKGROUP_DRAFT_PREFIX = "workgroup:"

data class WorkgroupChatUiState(
    val agentId: String = "",
    val workgroupId: String = "",
    val workgroupName: String = "",
    val description: String? = null,
    val members: List<WorkgroupMember> = emptyList(),
    val messages: List<WorkgroupMessage> = emptyList(),
    val inputText: String = "",
    val isConnected: Boolean = false,
    val isRunning: Boolean = false,
    val isSending: Boolean = false,
    val isLoading: Boolean = false,
    val isLoadingOlder: Boolean = false,
    val hasMoreHistory: Boolean = false,
    val error: String? = null
)

class WorkgroupChatViewModel(
    private val workgroupRepository: WorkgroupRepository,
    private val webSocket: RelayWebSocket,
    private val tokenStore: TokenStore
) : ViewModel() {
    private val _uiState = MutableStateFlow(WorkgroupChatUiState())
    val uiState: StateFlow<WorkgroupChatUiState> = _uiState.asStateFlow()

    private var sessionsJob: Job? = null
    private var currentSessionKey: String? = null

    init {
        viewModelScope.launch {
            webSocket.connectionState.collect { state ->
                val isConnected = state == RelayWebSocket.ConnectionState.CONNECTED
                _uiState.update { it.copy(isConnected = isConnected) }
                if (isConnected) {
                    requestLatestSession(showLoading = false)
                }
            }
        }
    }

    fun loadWorkgroup(agentId: String, workgroupId: String, workgroupName: String) {
        if (agentId.isBlank() || workgroupId.isBlank()) {
            return
        }
        currentSessionKey = sessionKey(agentId, workgroupId)
        _uiState.update {
            it.copy(
                agentId = agentId,
                workgroupId = workgroupId,
                workgroupName = workgroupName,
                description = null,
                members = emptyList(),
                messages = emptyList(),
                inputText = tokenStore.getDraft(draftKey(agentId, workgroupId)),
                isRunning = false,
                isLoading = true,
                isLoadingOlder = false,
                hasMoreHistory = false,
                isSending = false,
                error = null
            )
        }

        sessionsJob?.cancel()
        sessionsJob = viewModelScope.launch {
            workgroupRepository.sessions.collect { sessions ->
                val session = sessions[currentSessionKey] ?: return@collect
                _uiState.update { current ->
                    current.copy(
                        workgroupName = session.workgroupName.ifBlank { current.workgroupName },
                        description = session.description,
                        members = session.members,
                        messages = session.messages,
                        isRunning = session.isRunning,
                        hasMoreHistory = session.hasMoreHistory,
                        isLoading = false,
                        isLoadingOlder = false
                    )
                }
            }
        }

        requestLatestSession(showLoading = true)
    }

    fun refresh() {
        requestLatestSession(showLoading = true)
    }

    fun loadOlderMessages() {
        val state = _uiState.value
        if (state.agentId.isBlank() || state.workgroupId.isBlank() || state.isLoadingOlder || !state.hasMoreHistory) {
            return
        }
        val beforeId = state.messages.firstOrNull()?.id ?: return
        _uiState.update { it.copy(isLoadingOlder = true, error = null) }
        viewModelScope.launch {
            val result = workgroupRepository.requestSession(
                agentId = state.agentId,
                workgroupId = state.workgroupId,
                beforeId = beforeId
            )
            if (result.isFailure) {
                _uiState.update {
                    it.copy(
                        isLoadingOlder = false,
                        error = result.exceptionOrNull()?.message ?: "Failed to load older messages"
                    )
                }
            }
        }
    }

    fun updateInput(text: String) {
        val state = _uiState.value
        if (state.agentId.isNotBlank() && state.workgroupId.isNotBlank()) {
            tokenStore.saveDraft(draftKey(state.agentId, state.workgroupId), text)
        }
        _uiState.update { it.copy(inputText = text) }
    }

    fun sendMessage() {
        val state = _uiState.value
        if (state.agentId.isBlank() || state.workgroupId.isBlank() || state.isSending) {
            return
        }
        val textSnapshot = state.inputText
        if (textSnapshot.trim().isEmpty()) {
            return
        }

        tokenStore.clearDraft(draftKey(state.agentId, state.workgroupId))
        _uiState.update { it.copy(inputText = "", isSending = true, error = null) }
        viewModelScope.launch {
            val result = workgroupRepository.sendMessage(
                agentId = state.agentId,
                workgroupId = state.workgroupId,
                content = textSnapshot
            )
            if (result.isFailure) {
                CrashLogger.logError(
                    "WorkgroupChatViewModel",
                    "Failed to send workgroup message",
                    result.exceptionOrNull() as? Exception
                )
                tokenStore.saveDraft(draftKey(state.agentId, state.workgroupId), textSnapshot)
                _uiState.update {
                    it.copy(
                        inputText = textSnapshot,
                        error = result.exceptionOrNull()?.message ?: "Failed to send message"
                    )
                }
            }
            _uiState.update { it.copy(isSending = false) }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    private fun requestLatestSession(showLoading: Boolean) {
        val state = _uiState.value
        if (state.agentId.isBlank() || state.workgroupId.isBlank()) {
            return
        }
        if (webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED) {
            _uiState.update { it.copy(isLoading = false) }
            return
        }
        if (showLoading) {
            _uiState.update { it.copy(isLoading = true, error = null) }
        }
        viewModelScope.launch {
            val result = workgroupRepository.requestSession(
                agentId = state.agentId,
                workgroupId = state.workgroupId
            )
            if (result.isFailure) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = result.exceptionOrNull()?.message ?: "Failed to load workgroup"
                    )
                }
            }
        }
    }

    private fun draftKey(agentId: String, workgroupId: String): String =
        "$WORKGROUP_DRAFT_PREFIX${sessionKey(agentId, workgroupId)}"

    private fun sessionKey(agentId: String, workgroupId: String): String =
        "${agentId.trim()}::${workgroupId.trim()}"
}
