package com.claudecode.remote.ui.session

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.AgentWorkgroups
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.model.Workgroup
import com.claudecode.remote.data.model.WorkgroupSession
import com.claudecode.remote.data.remote.AuthSessionManager
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

enum class SessionListItemType {
    PROJECT,
    WORKGROUP
}

data class SessionListItem(
    val key: String,
    val type: SessionListItemType,
    val session: Session? = null,
    val agentId: String = "",
    val workgroupId: String? = null,
    val title: String,
    val previewText: String? = null,
    val previewTimestamp: Long? = null,
    val isPreviewStreaming: Boolean = false,
    val metaText: String? = null,
    val isOnline: Boolean = true,
    val isRunning: Boolean = false,
    val queuedCount: Int = 0
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
    private val authSessionManager: AuthSessionManager,
    private val tokenStore: TokenStore,
    private val workgroupRepository: WorkgroupRepository
) : ViewModel() {
    companion object {
        private const val RESUME_STALE_CONNECTION_TIMEOUT_MS = 20_000L
        private const val MANUAL_REFRESH_CONNECTION_WAIT_MS = 4_000L
        private const val MANUAL_REFRESH_CONNECTION_POLL_MS = 250L
    }

    private var latestSessions: List<Session> = emptyList()
    private var latestPreviewMap: Map<String, Message> = emptyMap()
    private var stablePreviewMap: Map<String, Message> = emptyMap()
    private var latestAgentWorkgroups: List<AgentWorkgroups> = emptyList()
    private var latestWorkgroupSessions: Map<String, WorkgroupSession> = emptyMap()
    private var initializeStarted = false

    private val _uiState = MutableStateFlow(SessionUiState())
    val uiState: StateFlow<SessionUiState> = _uiState.asStateFlow()

    val sessions = repository.sessions

    init {
        _uiState.update { it.copy(collapsedGroupKeys = tokenStore.getCollapsedSessionGroups()) }
        viewModelScope.launch {
            val cachedSessions = repository.getInboxSessionSnapshots()
            val cachedPreviews = messageRepository.getLatestConversationPreviewSnapshots()
            if (cachedPreviews.isNotEmpty()) {
                stablePreviewMap = cachedPreviews
                latestPreviewMap = cachedPreviews
            }
            if (cachedSessions.isNotEmpty()) {
                latestSessions = cachedSessions
                rebuildSessionItems()
                _uiState.update { current -> current.copy(isLoading = false) }
            }
        }
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
                latestAgentWorkgroups = groups
                _uiState.update { it.copy(agentWorkgroups = groups) }
                rebuildSessionItems()
            }
        }
        viewModelScope.launch {
            workgroupRepository.sessions.collect { sessions ->
                latestWorkgroupSessions = sessions
                rebuildSessionItems()
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
                    val trackedAgentIds = workgroupRepository.resolveTrackedAgentIds(agentIds)
                    workgroupRepository.retainAgentIds(trackedAgentIds)
                    if (trackedAgentIds.isNotEmpty() && webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED) {
                        workgroupRepository.refresh(trackedAgentIds)
                    }
                }
        }
        viewModelScope.launch {
            webSocket.connectionState.collect { state ->
                if (state == RelayWebSocket.ConnectionState.CONNECTED) {
                    messageRepository.requestProjectSyncs(repository.getSessions())
                    refreshWorkgroups(showLoading = false)
                }
            }
        }
    }

    fun initialize() {
        if (initializeStarted) {
            return
        }
        initializeStarted = true
        _uiState.update { current ->
            current.copy(
                isLoading = current.sessionItems.isEmpty() && latestSessions.isEmpty()
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
            val deviceId = tokenStore.getDeviceId()?.trim().orEmpty()
            val previousToken = tokenStore.getToken()?.trim().orEmpty()
            var tokenChanged = false

            if (deviceId.isNotEmpty() && tokenStore.hasSavedCredentials()) {
                authSessionManager.ensureValidToken(
                    clientId = deviceId,
                    forceRefresh = true
                ).onSuccess { refreshedToken ->
                    val normalized = refreshedToken.trim()
                    tokenChanged = normalized.isNotEmpty() && normalized != previousToken
                }.onFailure { error ->
                    _uiState.update { it.copy(error = error.message ?: "Failed to refresh relay token") }
                }
            }

            if (deviceId.isNotEmpty()) {
                try {
                    if (tokenChanged || webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED) {
                        webSocket.forceReconnect("manual-session-refresh")
                    } else {
                        webSocket.ensureHealthyConnection(
                            reason = "manual-session-refresh",
                            staleTimeoutMs = RESUME_STALE_CONNECTION_TIMEOUT_MS
                        )
                    }
                } catch (error: Exception) {
                    _uiState.update { it.copy(error = error.message ?: "Failed to reconnect relay") }
                }
            }

            var waitedMs = 0L
            while (
                waitedMs < MANUAL_REFRESH_CONNECTION_WAIT_MS &&
                webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED
            ) {
                delay(MANUAL_REFRESH_CONNECTION_POLL_MS)
                waitedMs += MANUAL_REFRESH_CONNECTION_POLL_MS
            }

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
                        refreshWorkgroups(showLoading = false, force = true)
                    }
                    _uiState.update { it.copy(isLoading = false) }
                },
                onFailure = { e -> _uiState.update { it.copy(isLoading = false, error = e.message) } }
            )
        }
    }

    fun onResume() {
        viewModelScope.launch {
            try {
                webSocket.ensureHealthyConnection(
                    reason = "session-list-resume",
                    staleTimeoutMs = RESUME_STALE_CONNECTION_TIMEOUT_MS
                )
            } catch (_: Exception) {
            }

            if (webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED) {
                webSocket.send(
                    Envelope(
                        id = UUID.randomUUID().toString(),
                        event = Events.PROJECT_LIST_REQUEST,
                        ts = System.currentTimeMillis()
                    )
                )
                messageRepository.requestProjectSyncs(repository.getSessions())
                refreshWorkgroups(showLoading = false)
            } else if (latestSessions.isEmpty()) {
                repository.syncFromServer(force = true)
            }
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

    private suspend fun refreshWorkgroups(showLoading: Boolean, force: Boolean = false) {
        val trackedAgentIds = workgroupRepository.resolveTrackedAgentIds(
            repository.getSessions()
            .map { it.agentId.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .sorted()
        )
        if (trackedAgentIds.isEmpty() || webSocket.connectionState.value != RelayWebSocket.ConnectionState.CONNECTED) {
            workgroupRepository.retainAgentIds(trackedAgentIds)
            return
        }
        if (showLoading) {
            _uiState.update { it.copy(isLoading = true) }
        }
        workgroupRepository.refresh(trackedAgentIds, force = force)
    }

    private fun rebuildSessionItems(queryOverride: String? = null) {
        val normalizedQuery = (queryOverride ?: _uiState.value.query)
            .trim()
            .lowercase()
        val sessionItems = latestSessions
            .map { session ->
                val preview = latestPreviewMap[session.projectId]
                SessionListItem(
                    key = "project:${session.id}",
                    type = SessionListItemType.PROJECT,
                    session = session,
                    agentId = session.agentId,
                    title = session.name,
                    previewText = preview?.toPreviewText()?.takeIf { it.isNotBlank() },
                    previewTimestamp = preview?.timestamp
                        ?: session.lastActiveAt.takeIf { it > 0L }
                        ?: session.createdAt.takeIf { it > 0L },
                    isPreviewStreaming = preview?.isStreaming == true,
                    metaText = buildString {
                        append(session.cliProvider)
                        session.groupName?.trim()?.takeIf { it.isNotEmpty() }?.let {
                            append(" · ")
                            append(it)
                        }
                    },
                    isOnline = session.isAgentOnline,
                    isRunning = session.isRunning,
                    queuedCount = session.queuedCount
                )
            }
        val workgroupItems = latestAgentWorkgroups.flatMap { agentGroups ->
            agentGroups.workgroups.map { workgroup ->
                buildWorkgroupListItem(agentGroups.agentId, workgroup)
            }
        }
        val items = (sessionItems + workgroupItems)
            .filter { item ->
                if (normalizedQuery.isBlank()) {
                    true
                } else {
                    buildSearchHaystack(item).contains(normalizedQuery)
                }
            }
            .sortedWith(
                compareByDescending<SessionListItem> { it.previewTimestamp ?: 0L }
                    .thenBy { it.title.lowercase() }
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
            append(item.title)
            append(' ')
            append(item.session?.projectPath.orEmpty())
            append(' ')
            append(item.agentId)
            append(' ')
            append(item.session?.groupName.orEmpty())
            append(' ')
            append(item.metaText.orEmpty())
            append(' ')
            append(item.previewText.orEmpty())
        }.lowercase()

    private fun buildWorkgroupListItem(agentId: String, workgroup: Workgroup): SessionListItem {
        val sessionKey = "${agentId.trim()}::${workgroup.id.trim()}"
        val session = latestWorkgroupSessions[sessionKey]
        val latestMessage = session?.messages?.lastOrNull()
        val previewText = latestMessage?.content?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: workgroup.lastMessagePreview?.trim()?.takeIf { it.isNotEmpty() }
            ?: workgroup.description?.trim()?.takeIf { it.isNotEmpty() }
        val previewTimestamp = maxOf(
            latestMessage?.updatedAt ?: 0L,
            latestMessage?.createdAt ?: 0L,
            session?.updatedAt ?: 0L,
            workgroup.updatedAt
        ).takeIf { it > 0L }

        return SessionListItem(
            key = "workgroup:$sessionKey",
            type = SessionListItemType.WORKGROUP,
            agentId = agentId,
            workgroupId = workgroup.id,
            title = workgroup.name,
            previewText = previewText,
            previewTimestamp = previewTimestamp,
            isPreviewStreaming = latestMessage?.status == "streaming",
            metaText = "$agentId · ${workgroup.memberCount} members",
            isOnline = webSocket.connectionState.value == RelayWebSocket.ConnectionState.CONNECTED,
            isRunning = session?.isRunning ?: workgroup.isRunning,
            queuedCount = 0
        )
    }

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
