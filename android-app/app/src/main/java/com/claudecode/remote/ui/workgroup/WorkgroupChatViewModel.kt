package com.claudecode.remote.ui.workgroup

import android.content.Context
import com.claudecode.remote.R
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
private const val WORKGROUP_VISIBLE_PAGE_SIZE = 30
private const val WORKGROUP_SYNC_PAGE_SIZE = 80

data class WorkgroupMentionSuggestion(
    val token: String,
    val label: String,
    val meta: String,
    val kind: String
)

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
    val mentionSuggestions: List<WorkgroupMentionSuggestion> = emptyList(),
    val error: String? = null
)

class WorkgroupChatViewModel(
    private val context: Context,
    private val workgroupRepository: WorkgroupRepository,
    private val webSocket: RelayWebSocket,
    private val tokenStore: TokenStore
) : ViewModel() {
    private val _uiState = MutableStateFlow(WorkgroupChatUiState())
    val uiState: StateFlow<WorkgroupChatUiState> = _uiState.asStateFlow()

    private var sessionsJob: Job? = null
    private var currentSessionKey: String? = null
    private var allMessages: List<WorkgroupMessage> = emptyList()
    private var visibleMessageCount: Int = WORKGROUP_VISIBLE_PAGE_SIZE

    private fun text(resId: Int, vararg args: Any): String = context.getString(resId, *args)

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
        allMessages = emptyList()
        visibleMessageCount = WORKGROUP_VISIBLE_PAGE_SIZE
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
                mentionSuggestions = buildMentionSuggestions(
                    text = tokenStore.getDraft(draftKey(agentId, workgroupId)),
                    members = emptyList()
                ),
                error = null
            )
        }

        sessionsJob?.cancel()
        sessionsJob = viewModelScope.launch {
            workgroupRepository.sessions.collect { sessions ->
                val session = sessions[currentSessionKey] ?: return@collect
                allMessages = session.messages
                _uiState.update { current ->
                    current.copy(
                        workgroupName = session.workgroupName.ifBlank { current.workgroupName },
                        description = session.description,
                        members = session.members,
                        isRunning = session.isRunning,
                        mentionSuggestions = buildMentionSuggestions(
                            text = current.inputText,
                            members = session.members
                        ),
                        isLoading = false,
                        isLoadingOlder = false
                    )
                }
                publishVisibleMessages(
                    hasMoreRemoteHistory = session.hasMoreHistory
                )
                maybeLoadMoreHistory()
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
        if (visibleMessageCount < allMessages.size) {
            visibleMessageCount += WORKGROUP_VISIBLE_PAGE_SIZE
            publishVisibleMessages(hasMoreRemoteHistory = state.hasMoreHistory)
            maybeLoadMoreHistory()
            return
        }
        val beforeId = state.messages.firstOrNull()?.id ?: return
        _uiState.update { it.copy(isLoadingOlder = true, error = null) }
        viewModelScope.launch {
            val result = workgroupRepository.requestSession(
                agentId = state.agentId,
                workgroupId = state.workgroupId,
                beforeId = beforeId,
                limit = WORKGROUP_SYNC_PAGE_SIZE
            )
            if (result.isFailure) {
                _uiState.update {
                    it.copy(
                        isLoadingOlder = false,
                        error = result.exceptionOrNull()?.message ?: text(R.string.workgroups_error_load_older)
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
        _uiState.update {
            it.copy(
                inputText = text,
                mentionSuggestions = buildMentionSuggestions(text, it.members)
            )
        }
    }

    fun applyMentionSuggestion(suggestion: WorkgroupMentionSuggestion) {
        val state = _uiState.value
        val text = state.inputText
        val match = Regex("(^|\\s)@([^\\s@]*)$").find(text) ?: return
        val replacement = "@${suggestion.token} "
        val updated = text.replaceRange(match.range.first + match.value.indexOf('@'), match.range.last + 1, replacement)
        updateInput(updated)
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
        _uiState.update { it.copy(inputText = "", isSending = true, mentionSuggestions = emptyList(), error = null) }
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
                        mentionSuggestions = buildMentionSuggestions(textSnapshot, it.members),
                        error = result.exceptionOrNull()?.message ?: text(R.string.workgroups_error_send_message)
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
                workgroupId = state.workgroupId,
                limit = WORKGROUP_SYNC_PAGE_SIZE
            )
            if (result.isFailure) {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = result.exceptionOrNull()?.message ?: text(R.string.workgroups_error_load)
                    )
                }
            }
        }
    }

    private fun publishVisibleMessages(hasMoreRemoteHistory: Boolean) {
        val startIndex = (allMessages.size - visibleMessageCount).coerceAtLeast(0)
        val visibleMessages = allMessages.drop(startIndex)
        _uiState.update {
            it.copy(
                messages = visibleMessages,
                hasMoreHistory = hasMoreRemoteHistory || startIndex > 0
            )
        }
    }

    private fun maybeLoadMoreHistory() {
        val state = _uiState.value
        if (
            state.agentId.isBlank() ||
            state.workgroupId.isBlank() ||
            state.isLoading ||
            state.isLoadingOlder ||
            !state.hasMoreHistory ||
            !state.isConnected
        ) {
            return
        }
        if (allMessages.size >= visibleMessageCount) {
            return
        }
        val beforeId = state.messages.firstOrNull()?.id ?: return
        _uiState.update { it.copy(isLoadingOlder = true) }
        viewModelScope.launch {
            val result = workgroupRepository.requestSession(
                agentId = state.agentId,
                workgroupId = state.workgroupId,
                beforeId = beforeId,
                limit = WORKGROUP_SYNC_PAGE_SIZE
            )
            if (result.isFailure) {
                _uiState.update {
                    it.copy(
                        isLoadingOlder = false,
                        error = result.exceptionOrNull()?.message ?: text(R.string.workgroups_error_load_older)
                    )
                }
            }
        }
    }

    private fun draftKey(agentId: String, workgroupId: String): String =
        "$WORKGROUP_DRAFT_PREFIX${sessionKey(agentId, workgroupId)}"

    private fun sessionKey(agentId: String, workgroupId: String): String =
        "${agentId.trim()}::${workgroupId.trim()}"

    private fun buildMentionSuggestions(
        text: String,
        members: List<WorkgroupMember>
    ): List<WorkgroupMentionSuggestion> {
        val match = Regex("(^|\\s)@([^\\s@]*)$").find(text) ?: return emptyList()
        val query = match.groupValues.getOrNull(2)?.trim()?.lowercase().orEmpty()

        val baseSuggestions = buildList {
            add(
                WorkgroupMentionSuggestion(
                    token = "all",
                    label = "@all",
                    meta = text(R.string.workgroups_mention_all),
                    kind = "all"
                )
            )
            add(
                WorkgroupMentionSuggestion(
                    token = "developer",
                    label = "@developer",
                    meta = text(R.string.workgroups_mention_developer),
                    kind = "role"
                )
            )
            add(
                WorkgroupMentionSuggestion(
                    token = "qa",
                    label = "@qa",
                    meta = text(R.string.workgroups_mention_qa),
                    kind = "role"
                )
            )
            add(
                WorkgroupMentionSuggestion(
                    token = "pm",
                    label = "@pm",
                    meta = text(R.string.workgroups_mention_pm),
                    kind = "role"
                )
            )
            members
                .filter { it.name.isNotBlank() }
                .sortedBy { it.name.lowercase() }
                .forEach { member ->
                    add(
                        WorkgroupMentionSuggestion(
                            token = member.name.trim(),
                            label = "@${member.name.trim()}",
                            meta = translateMemberRole(member.role),
                            kind = "member"
                        )
                    )
                }
        }

        if (query.isBlank()) {
            return baseSuggestions.take(6)
        }

        return baseSuggestions.filter { suggestion ->
            suggestion.token.lowercase().contains(query)
                || suggestion.label.lowercase().contains(query)
                || suggestion.meta.lowercase().contains(query)
        }.take(6)
    }

    private fun translateMemberRole(role: String): String {
        return when (role.trim().lowercase()) {
            "developer" -> text(R.string.workgroups_mention_developer)
            "qa" -> text(R.string.workgroups_mention_qa)
            "project_manager", "pm" -> text(R.string.workgroups_mention_pm)
            else -> text(R.string.workgroups_mention_member)
        }
    }
}
