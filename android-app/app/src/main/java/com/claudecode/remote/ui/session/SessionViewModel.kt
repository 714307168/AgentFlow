package com.claudecode.remote.ui.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.AgentWorkgroups
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Message
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

data class SessionListItem(
    val session: Session,
    val previewText: String? = null,
    val previewTimestamp: Long? = null,
    val isPreviewStreaming: Boolean = false
)

data class SessionUiState(
    val sessionItems: List<SessionListItem> = emptyList(),
    val agentWorkgroups: List<AgentWorkgroups> = emptyList(),
    val query: String = "",
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
    private var latestSessions: List<Session> = emptyList()
    private var latestPreviewMap: Map<String, Message> = emptyMap()
    private var stablePreviewMap: Map<String, Message> = emptyMap()

    private val _uiState = MutableStateFlow(SessionUiState())
    val uiState: StateFlow<SessionUiState> = _uiState.asStateFlow()

    val sessions = repository.sessions

    init {
        _uiState.update { it.copy(collapsedGroupKeys = tokenStore.getCollapsedSessionGroups()) }
        viewModelScope.launch {
            repository.sessions.collect { sessions ->
                latestSessions = sessions
                rebuildSessionItems()
            }
        }
        viewModelScope.launch {
            messageRepository.getLatestConversationPreviews().collect { previews ->
                val nextStableMap = stablePreviewMap.toMutableMap()
                previews.forEach { (projectId, preview) ->
                    val previous = nextStableMap[projectId]
                    if (!preview.isStreaming || previous == null) {
                        nextStableMap[projectId] = preview
                    }
                }
                val activeProjectIds = latestSessions.map { it.projectId }.toSet()
                stablePreviewMap = nextStableMap.filterKeys { projectId ->
                    projectId in activeProjectIds || projectId in previews.keys
                }
                latestPreviewMap = stablePreviewMap
                rebuildSessionItems()
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
                isLoading = current.sessionItems.isEmpty()
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

    fun updateQuery(query: String) {
        _uiState.update { it.copy(query = query) }
        rebuildSessionItems(query)
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

    private fun rebuildSessionItems(queryOverride: String? = null) {
        val normalizedQuery = (queryOverride ?: _uiState.value.query)
            .trim()
            .lowercase()
        val items = latestSessions
            .map { session ->
                val preview = latestPreviewMap[session.projectId]
                SessionListItem(
                    session = session,
                    previewText = preview?.toPreviewText()?.takeIf { it.isNotBlank() },
                    previewTimestamp = preview?.timestamp,
                    isPreviewStreaming = preview?.isStreaming == true
                )
            }
            .filter { item ->
                if (normalizedQuery.isBlank()) {
                    true
                } else {
                    buildSearchHaystack(item).contains(normalizedQuery)
                }
            }
            .sortedWith(
                compareByDescending<SessionListItem> { item ->
                    item.previewTimestamp
                        ?: item.session.createdAt
                }
                    .thenBy { it.session.name.lowercase() }
                    .thenBy { it.session.id }
            )

        _uiState.update { current ->
            if (current.sessionItems == items) {
                current
            } else {
                current.copy(sessionItems = items)
            }
        }
    }

    private fun buildSearchHaystack(item: SessionListItem): String =
        buildString {
            append(item.session.name)
            append(' ')
            append(item.session.projectPath)
            append(' ')
            append(item.session.agentId)
            append(' ')
            append(item.session.groupName.orEmpty())
            append(' ')
            append(item.previewText.orEmpty())
        }.lowercase()

    private fun Message.toPreviewText(): String {
        val singleLineContent = content
            .replace("\r\n", "\n")
            .lineSequence()
            .map { it.trim() }
            .firstOrNull { it.isNotEmpty() }
            .orEmpty()
        if (singleLineContent.isNotBlank()) {
            return singleLineContent
        }

        val firstAttachmentName = attachments.firstOrNull()?.name?.trim().orEmpty()
        return when {
            firstAttachmentName.isBlank() -> ""
            attachments.size == 1 -> firstAttachmentName
            else -> "$firstAttachmentName +${attachments.size - 1}"
        }
    }
}
