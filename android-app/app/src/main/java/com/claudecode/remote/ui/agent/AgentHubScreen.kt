package com.claudecode.remote.ui.agent

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudecode.remote.R
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.model.Workgroup
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.util.AlphabeticalSort

private const val DEFAULT_GROUP_KEY = "__default__"
private const val COLLABORATION_GROUP_KEY = "__collaboration__"

@Composable
fun AgentHubScreen(
    viewModel: AgentHubViewModel,
    webSocket: RelayWebSocket,
    onNavigateToChat: (Session) -> Unit,
    onOpenWorkgroupChat: (agentId: String, workgroupId: String, workgroupName: String) -> Unit,
    onToggleConnection: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by webSocket.connectionState.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.initialize()
    }

    val groupedSessions = uiState.sessions
        .groupBy { session ->
            session.groupName?.trim().takeUnless { it.isNullOrEmpty() } ?: DEFAULT_GROUP_KEY
        }
        .map { (groupKey, sessions) ->
            AgentSessionGroup(
                key = groupKey,
                title = if (groupKey == DEFAULT_GROUP_KEY) {
                    stringResource(R.string.default_group)
                } else {
                    groupKey
                },
                sessions = sessions.sortedWith(compareBy<Session>(
                    { AlphabeticalSort.sortKey(it.name) },
                    { it.name.lowercase() },
                    { it.projectPath.lowercase() }
                ))
            )
        }
        .sortedWith { left, right ->
            AlphabeticalSort.compareStrings(left.title, right.title)
        }
    val workgroups = uiState.agentWorkgroups
        .flatMap { group -> group.workgroups.map { workgroup -> group.agentId to workgroup } }
        .sortedWith(
            compareBy<Pair<String, Workgroup>>(
                { AlphabeticalSort.sortKey(it.second.name) },
                { it.second.name.lowercase() },
                { it.first.lowercase() }
            )
        )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.background,
                        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.28f),
                        MaterialTheme.colorScheme.surface
                    )
                )
            )
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets(0, 0, 0, 0)
        ) { padding ->
            Box(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .statusBarsPadding()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    AgentHeader(
                        connectionState = connectionState,
                        isRefreshing = uiState.isLoading,
                        onRefresh = viewModel::refresh,
                        onToggleConnection = onToggleConnection
                    )

                    JoinWorkgroupCard(
                        query = uiState.registryQuery,
                        isSearching = uiState.isSearchingRegistry,
                        results = uiState.registryResults.map { entry ->
                            Triple(
                                entry.name,
                                entry.groupNumber,
                                entry.ownerUsername?.takeIf { it.isNotBlank() }
                                    ?: stringResource(R.string.workgroups_owner_unknown)
                            )
                        },
                        joiningGroupNumber = uiState.joiningGroupNumber,
                        onQueryChange = viewModel::updateRegistryQuery,
                        onSearch = viewModel::searchRegistry,
                        onJoin = viewModel::joinWorkgroup,
                        enabled = viewModel.isConnected()
                    )

                    if (uiState.isLoading && uiState.sessions.isEmpty() && workgroups.isEmpty()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    } else if (uiState.sessions.isEmpty() && workgroups.isEmpty()) {
                        Surface(
                            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                            shape = RoundedCornerShape(24.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = stringResource(R.string.agents_empty),
                                modifier = Modifier.padding(18.dp),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(bottom = 20.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            groupedSessions.forEach { group ->
                                item("header-${group.key}") {
                                    CollapsibleHeader(
                                        title = group.title,
                                        count = group.sessions.size,
                                        collapsed = uiState.collapsedGroupKeys.contains(group.key),
                                        onToggle = { viewModel.toggleGroupCollapsed(group.key) }
                                    )
                                }
                                if (!uiState.collapsedGroupKeys.contains(group.key)) {
                                    items(group.sessions, key = { it.id }) { session ->
                                        SimpleProjectCard(session = session, onClick = { onNavigateToChat(session) })
                                    }
                                }
                            }
                            if (workgroups.isNotEmpty()) {
                                item("header-$COLLABORATION_GROUP_KEY") {
                                    CollapsibleHeader(
                                        title = stringResource(R.string.agents_collaboration_group),
                                        count = workgroups.size,
                                        collapsed = uiState.collapsedGroupKeys.contains(COLLABORATION_GROUP_KEY),
                                        onToggle = { viewModel.toggleGroupCollapsed(COLLABORATION_GROUP_KEY) }
                                    )
                                }
                                if (!uiState.collapsedGroupKeys.contains(COLLABORATION_GROUP_KEY)) {
                                    items(workgroups, key = { (agentId, workgroup) -> "$agentId:${workgroup.id}" }) { (agentId, workgroup) ->
                                        SimpleWorkgroupCard(
                                            agentId = agentId,
                                            workgroup = workgroup,
                                            onClick = { onOpenWorkgroupChat(agentId, workgroup.id, workgroup.name) }
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                uiState.error?.let { error ->
                    Snackbar(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(16.dp),
                        action = {
                            TextButton(onClick = { viewModel.clearError() }) {
                                Text(stringResource(R.string.dismiss))
                            }
                        }
                    ) {
                        Text(error)
                    }
                }
            }
        }
    }
}

@Composable
private fun AgentHeader(
    connectionState: RelayWebSocket.ConnectionState,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onToggleConnection: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = stringResource(R.string.nav_agents),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = when (connectionState) {
                    RelayWebSocket.ConnectionState.CONNECTED -> stringResource(R.string.status_connected)
                    RelayWebSocket.ConnectionState.CONNECTING -> stringResource(R.string.status_connecting)
                    RelayWebSocket.ConnectionState.RECONNECTING -> stringResource(R.string.status_reconnecting)
                    RelayWebSocket.ConnectionState.DISCONNECTED -> stringResource(R.string.status_offline)
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Surface(
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
            shape = RoundedCornerShape(18.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.14f))
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                IconButton(
                    onClick = onRefresh,
                    enabled = connectionState == RelayWebSocket.ConnectionState.CONNECTED && !isRefreshing,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = stringResource(R.string.action_refresh))
                }
                IconButton(
                    onClick = onToggleConnection,
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(Icons.Default.PowerSettingsNew, contentDescription = stringResource(R.string.action_toggle_connection))
                }
            }
        }
    }
}

@Composable
private fun JoinWorkgroupCard(
    query: String,
    isSearching: Boolean,
    results: List<Triple<String, String, String>>,
    joiningGroupNumber: String?,
    onQueryChange: (String) -> Unit,
    onSearch: () -> Unit,
    onJoin: (String) -> Unit,
    enabled: Boolean
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = stringResource(R.string.workgroups_join_title),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.SemiBold
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = query,
                    onValueChange = onQueryChange,
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    placeholder = { Text(stringResource(R.string.workgroups_group_number_hint)) }
                )
                TextButton(
                    onClick = onSearch,
                    enabled = enabled && !isSearching,
                    modifier = Modifier.heightIn(min = 52.dp)
                ) {
                    Text(if (isSearching) stringResource(R.string.workgroups_searching) else stringResource(R.string.workgroups_search))
                }
            }
            results.forEach { (name, groupNumber, owner) ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Text(
                            text = stringResource(R.string.workgroups_group_number_label, groupNumber),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Text(owner, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    TextButton(onClick = { onJoin(groupNumber) }, enabled = joiningGroupNumber != groupNumber) {
                        Text(if (joiningGroupNumber == groupNumber) stringResource(R.string.workgroups_joining) else stringResource(R.string.workgroups_join_action))
                    }
                }
            }
        }
    }
}

@Composable
private fun CollapsibleHeader(
    title: String,
    count: Int,
    collapsed: Boolean,
    onToggle: () -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text(
            text = "$title ($count)",
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.weight(1f)
        )
        IconButton(onClick = onToggle, modifier = Modifier.size(30.dp)) {
            Icon(
                imageVector = if (collapsed) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                contentDescription = null
            )
        }
    }
}

@Composable
private fun SimpleProjectCard(session: Session, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.97f)),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(session.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(session.projectPath, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    text = stringResource(R.string.agents_project_meta, session.agentId.take(8), runtimeLabel(session)),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SimpleWorkgroupCard(agentId: String, workgroup: Workgroup, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.97f)),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(Icons.Default.Groups, contentDescription = null, tint = MaterialTheme.colorScheme.secondary)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(workgroup.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    text = workgroup.lastMessagePreview?.takeIf { it.isNotBlank() }
                        ?: workgroup.description?.takeIf { it.isNotBlank() }
                        ?: stringResource(R.string.workgroups_open_chat_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = stringResource(R.string.agents_collaboration_meta, agentId.take(8), workgroup.memberCount, workgroup.messageCount),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun runtimeLabel(session: Session): String =
    when {
        !session.isAgentOnline -> stringResource(R.string.status_agent_offline)
        session.isRunning -> stringResource(R.string.status_running)
        session.queuedCount > 0 -> stringResource(R.string.status_queued, session.queuedCount)
        else -> stringResource(R.string.status_ready)
    }
