package com.claudecode.remote.ui.session

import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import com.claudecode.remote.R
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.update.AppUpdateState
import com.claudecode.remote.update.AppUpdateStatus

private const val SESSION_LIST_TOP_SNAP_THRESHOLD_PX = 24

@Composable
fun SessionListScreen(
    viewModel: SessionViewModel,
    webSocket: RelayWebSocket,
    updateState: AppUpdateState,
    onCheckForUpdates: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onNavigateToChat: (session: Session) -> Unit,
    onNavigateToWorkgroupChat: (agentId: String, workgroupId: String, workgroupName: String) -> Unit,
    onRefreshSessions: () -> Unit,
    onToggleConnection: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = context as? LifecycleOwner
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by webSocket.connectionState.collectAsState()
    val connectionError by webSocket.errorMessage.collectAsState()
    val listState = rememberLazyListState()
    val anchorItemKey = remember { mutableStateOf<String?>(null) }
    val anchorItemOffset = remember { mutableIntStateOf(0) }
    val shouldStickToTop = remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        viewModel.initialize()
    }

    LaunchedEffect(listState, uiState.sessionItems) {
        snapshotFlow {
            val index = listState.firstVisibleItemIndex
            Triple(
                uiState.sessionItems.getOrNull(index)?.key,
                listState.firstVisibleItemScrollOffset,
                index == 0 && listState.firstVisibleItemScrollOffset <= SESSION_LIST_TOP_SNAP_THRESHOLD_PX
            )
        }.collect { (key, offset, isNearTop) ->
            anchorItemKey.value = key
            anchorItemOffset.intValue = offset
            shouldStickToTop.value = isNearTop
        }
    }

    LaunchedEffect(uiState.sessionItems.map { it.key }) {
        if (uiState.sessionItems.isEmpty()) {
            return@LaunchedEffect
        }
        if (shouldStickToTop.value) {
            if (listState.firstVisibleItemIndex != 0 || listState.firstVisibleItemScrollOffset != 0) {
                listState.scrollToItem(0)
            }
            return@LaunchedEffect
        }
        val anchorKey = anchorItemKey.value ?: return@LaunchedEffect
        val targetIndex = uiState.sessionItems.indexOfFirst { it.key == anchorKey }
        if (targetIndex >= 0 && targetIndex != listState.firstVisibleItemIndex) {
            listState.scrollToItem(targetIndex, anchorItemOffset.intValue)
        }
    }

    DisposableEffect(lifecycleOwner) {
        if (lifecycleOwner == null) {
            onDispose { }
        } else {
            val observer = LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) {
                    viewModel.onResume()
                }
            }
            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose {
                lifecycleOwner.lifecycle.removeObserver(observer)
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
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
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                SessionHeader(
                    connectionState = connectionState,
                    totalCount = uiState.sessionItems.size,
                    isRefreshing = uiState.isLoading,
                    onRefresh = onRefreshSessions,
                    onToggleConnection = onToggleConnection
                )

                SessionSearchBar(
                    value = uiState.query,
                    onValueChange = viewModel::updateQuery
                )

                when {
                    uiState.isLoading && uiState.sessionItems.isEmpty() -> {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    }

                    else -> {
                        LazyColumn(
                            state = listState,
                            modifier = Modifier.weight(1f),
                            contentPadding = PaddingValues(bottom = 16.dp),
                            verticalArrangement = Arrangement.spacedBy(0.dp)
                        ) {
                            if (updateState.status == AppUpdateStatus.AVAILABLE ||
                                updateState.status == AppUpdateStatus.DOWNLOADED
                            ) {
                                item(key = "update-banner") {
                                    UpdateBanner(
                                        updateState = updateState,
                                        onPrimaryAction = {
                                            if (updateState.status == AppUpdateStatus.DOWNLOADED) {
                                                onInstallUpdate()
                                            } else {
                                                onDownloadUpdate()
                                            }
                                        },
                                        onSecondaryAction = onCheckForUpdates
                                    )
                                    Spacer(modifier = Modifier.size(8.dp))
                                }
                            }

                            if (uiState.sessionItems.isEmpty()) {
                                item(key = "empty-state") {
                                    Surface(
                                        color = MaterialTheme.colorScheme.surface,
                                        shape = RoundedCornerShape(24.dp),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(top = 4.dp)
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(horizontal = 24.dp, vertical = 56.dp),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            Text(
                                                text = if (uiState.query.isBlank()) {
                                                    stringResource(R.string.no_sessions)
                                                } else {
                                                    stringResource(R.string.session_search_empty)
                                                },
                                                style = MaterialTheme.typography.bodyLarge,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                    }
                                }
                            } else {
                                items(uiState.sessionItems, key = { it.key }) { item ->
                                    SessionCard(
                                        item = item,
                                        onClick = {
                                            when (item.type) {
                                                SessionListItemType.PROJECT -> item.session?.let(onNavigateToChat)
                                                SessionListItemType.WORKGROUP -> {
                                                    val workgroupId = item.workgroupId ?: return@SessionCard
                                                    onNavigateToWorkgroupChat(item.agentId, workgroupId, item.title)
                                                }
                                            }
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }

            val shouldShowConnectionError =
                connectionState == RelayWebSocket.ConnectionState.DISCONNECTED &&
                    !connectionError.isNullOrBlank()
            if (shouldShowConnectionError) {
                val error = connectionError.orEmpty()
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp),
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    action = {
                        TextButton(onClick = { webSocket.clearErrorMessage() }) {
                            Text(stringResource(R.string.dismiss))
                        }
                    }
                ) {
                    Text(error)
                }
            }

            uiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(16.dp)
                        .padding(bottom = 60.dp),
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

@Composable
private fun SessionSearchBar(
    value: String,
    onValueChange: (String) -> Unit
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.Search,
                contentDescription = stringResource(R.string.session_search_hint)
            )
        },
        placeholder = {
            Text(stringResource(R.string.session_search_hint))
        },
        shape = RoundedCornerShape(16.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.42f),
            unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.18f)
        )
    )
}

@Composable
private fun UpdateBanner(
    updateState: AppUpdateState,
    onPrimaryAction: () -> Unit,
    onSecondaryAction: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.92f),
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)),
        shadowElevation = 4.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = if (updateState.status == AppUpdateStatus.DOWNLOADED) {
                    stringResource(R.string.session_update_ready_title, updateState.latestVersion ?: "?")
                } else {
                    stringResource(R.string.session_update_available_title, updateState.latestVersion ?: "?")
                },
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )
            if (updateState.notes.isNotBlank()) {
                Text(
                    text = updateState.notes,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.88f),
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = RoundedCornerShape(999.dp)
                ) {
                    TextButton(onClick = onPrimaryAction) {
                        Text(
                            text = if (updateState.status == AppUpdateStatus.DOWNLOADED) {
                                stringResource(R.string.session_install_update)
                            } else {
                                stringResource(R.string.session_download_update)
                            },
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    }
                }
                TextButton(onClick = onSecondaryAction) {
                    Text(stringResource(R.string.action_refresh))
                }
            }
        }
    }
}

@Composable
private fun SessionHeader(
    connectionState: RelayWebSocket.ConnectionState,
    totalCount: Int,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onToggleConnection: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = stringResource(R.string.nav_messages),
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                ConnectionStatusBadge(connectionState)
                if (totalCount > 0) {
                    Text(
                        text = stringResource(R.string.session_summary_projects, totalCount),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }

        Surface(
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(16.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.14f)),
            shadowElevation = 2.dp
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 6.dp, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                HeaderActionButton(
                    icon = Icons.Default.Refresh,
                    contentDescription = stringResource(R.string.action_refresh),
                    enabled = connectionState == RelayWebSocket.ConnectionState.CONNECTED && !isRefreshing,
                    tint = MaterialTheme.colorScheme.onSurface,
                    onClick = onRefresh
                )
                HeaderActionButton(
                    icon = Icons.Default.PowerSettingsNew,
                    contentDescription = stringResource(R.string.action_toggle_connection),
                    enabled = true,
                    tint = if (connectionState == RelayWebSocket.ConnectionState.CONNECTED) {
                        Color(0xFF4CAF50)
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    onClick = onToggleConnection
                )
            }
        }
    }
}

@Composable
private fun HeaderActionButton(
    icon: ImageVector,
    contentDescription: String,
    enabled: Boolean,
    tint: Color,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = if (enabled) {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.48f)
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.24f)
        }
    ) {
        IconButton(
            onClick = onClick,
            enabled = enabled,
            modifier = Modifier.size(38.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = if (enabled) tint else MaterialTheme.colorScheme.outline
            )
        }
    }
}

private fun providerLabel(provider: String): String =
    if (provider == "codex") "OpenAI Codex" else "Claude Code"

private fun modelLabel(model: String?): String =
    model?.trim().takeUnless { it.isNullOrEmpty() } ?: "Auto"

@Composable
private fun runtimeLabel(session: Session): String =
    when {
        !session.isAgentOnline -> stringResource(R.string.status_agent_offline)
        session.isRunning -> stringResource(R.string.status_running)
        session.queuedCount > 0 -> stringResource(R.string.status_queued, session.queuedCount)
        else -> stringResource(R.string.status_ready)
    }

@Composable
private fun runtimeColor(session: Session): Color =
    when {
        !session.isAgentOnline -> MaterialTheme.colorScheme.error
        session.isRunning -> MaterialTheme.colorScheme.tertiary
        session.queuedCount > 0 -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.secondary
    }

@Composable
private fun SummaryPill(
    text: String,
    containerColor: Color,
    contentColor: Color
) {
    Surface(
        color = containerColor,
        shape = RoundedCornerShape(999.dp)
    ) {
        Text(
            text = text,
            color = contentColor,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
        )
    }
}

@Composable
private fun SessionCard(item: SessionListItem, onClick: () -> Unit) {
    val session = item.session ?: Session(
        id = item.key,
        name = item.title,
        agentId = item.agentId,
        projectId = item.workgroupId ?: item.key,
        projectPath = item.metaText.orEmpty(),
        isAgentOnline = item.isOnline,
        isRunning = item.isRunning,
        queuedCount = item.queuedCount,
        createdAt = item.previewTimestamp ?: 0L,
        lastActiveAt = item.previewTimestamp ?: 0L
    )
    val avatar = item.title.firstOrNull()?.uppercase() ?: "C"
    val previewText = item.previewText ?: session.projectPath.ifBlank { item.metaText.orEmpty() }
    val timestamp = item.previewTimestamp ?: session.createdAt
    val metaText = buildString {
        append(providerLabel(session.cliProvider))
        modelLabel(session.cliModel)
            .takeUnless { it.equals("Auto", ignoreCase = true) }
            ?.let {
                append(" / ")
                append(it)
            }
        session.groupName?.trim()?.takeUnless { it.isEmpty() }?.let {
            append(" · ")
            append(it)
        }
    }

    val statusLabel = if (item.type == SessionListItemType.PROJECT) {
        runtimeLabel(session)
    } else {
        when {
            !item.isOnline -> stringResource(R.string.status_offline)
            item.isRunning -> stringResource(R.string.status_running)
            else -> stringResource(R.string.status_ready)
        }
    }
    val statusColor = if (item.type == SessionListItemType.PROJECT) {
        runtimeColor(session)
    } else {
        when {
            !item.isOnline -> MaterialTheme.colorScheme.error
            item.isRunning -> MaterialTheme.colorScheme.tertiary
            else -> MaterialTheme.colorScheme.secondary
        }
    }

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(0.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
        border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.08f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = if (item.isOnline) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.errorContainer
                },
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.size(40.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = avatar,
                        style = MaterialTheme.typography.titleSmall,
                        color = if (item.isOnline) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onErrorContainer
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.width(10.dp))

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = formatTimestamp(timestamp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Text(
                    text = previewText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontWeight = if (item.isPreviewStreaming) FontWeight.Medium else FontWeight.Normal,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Box(
                        modifier = Modifier
                            .size(7.dp)
                            .clip(CircleShape)
                            .background(
                                if (item.isOnline) Color(0xFF4CAF50) else Color(0xFFEF5350)
                            )
                    )
                    Text(
                        text = if (item.type == SessionListItemType.PROJECT) metaText else item.metaText.orEmpty(),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    if (item.isRunning || item.queuedCount > 0 || !item.isOnline) {
                        SummaryPill(
                            text = statusLabel,
                            containerColor = statusColor.copy(alpha = 0.12f),
                            contentColor = statusColor
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ConnectionStatusBadge(state: RelayWebSocket.ConnectionState) {
    val (color, text) = when (state) {
        RelayWebSocket.ConnectionState.CONNECTED -> Color(0xFF4CAF50) to stringResource(R.string.status_connected)
        RelayWebSocket.ConnectionState.CONNECTING -> Color(0xFFFFA726) to stringResource(R.string.status_connecting)
        RelayWebSocket.ConnectionState.RECONNECTING -> Color(0xFFFFA726) to stringResource(R.string.status_reconnecting)
        RelayWebSocket.ConnectionState.DISCONNECTED -> Color(0xFFEF5350) to stringResource(R.string.status_offline)
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .border(
                width = 1.dp,
                color = color.copy(alpha = 0.14f),
                shape = RoundedCornerShape(999.dp)
            )
            .background(color.copy(alpha = 0.12f), shape = RoundedCornerShape(999.dp))
            .padding(horizontal = 9.dp, vertical = 5.dp)
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(color)
        )
        Text(
            text = text,
            fontSize = 11.sp,
            color = color,
            fontWeight = FontWeight.Medium
        )
    }
}

private fun formatTimestamp(timestamp: Long): String =
    java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.getDefault()).format(java.util.Date(timestamp))
