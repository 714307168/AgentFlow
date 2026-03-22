package com.claudecode.remote.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PowerSettingsNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudecode.remote.R
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.update.AppUpdateState
import com.claudecode.remote.update.AppUpdateStatus

@Composable
fun SessionListScreen(
    viewModel: SessionViewModel,
    webSocket: RelayWebSocket,
    updateState: AppUpdateState,
    onCheckForUpdates: () -> Unit,
    onDownloadUpdate: () -> Unit,
    onInstallUpdate: () -> Unit,
    onNavigateToChat: (session: Session) -> Unit,
    onRefreshSessions: () -> Unit,
    onToggleConnection: () -> Unit,
    onNavigateToSettings: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by webSocket.connectionState.collectAsState()
    val connectionError by webSocket.errorMessage.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.initialize()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.background,
                        MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.34f),
                        MaterialTheme.colorScheme.surface
                    )
                )
            )
    ) {
        Scaffold(
            containerColor = Color.Transparent,
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
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    SessionHeader(
                        connectionState = connectionState,
                        isRefreshing = uiState.isLoading,
                        onRefresh = onRefreshSessions,
                        onToggleConnection = onToggleConnection,
                        onOpenSettings = onNavigateToSettings
                    )

                    if (updateState.status == AppUpdateStatus.AVAILABLE ||
                        updateState.status == AppUpdateStatus.DOWNLOADED
                    ) {
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
                    }

                    when {
                        uiState.isLoading && uiState.sessions.isEmpty() -> {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .weight(1f),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator()
                            }
                        }

                        uiState.sessions.isEmpty() -> {
                            Surface(
                                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                                shape = RoundedCornerShape(28.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .weight(1f)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(24.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = stringResource(R.string.no_sessions),
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }

                        else -> {
                            LazyColumn(
                                modifier = Modifier.weight(1f),
                                contentPadding = PaddingValues(bottom = 16.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                items(uiState.sessions, key = { it.id }) { session ->
                                    SessionCard(
                                        session = session,
                                        onClick = { onNavigateToChat(session) }
                                    )
                                }
                            }
                        }
                    }
                }

                if (uiState.isLoading && uiState.sessions.isNotEmpty()) {
                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                        shadowElevation = 6.dp,
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(top = 12.dp, end = 20.dp)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp
                            )
                            Text(
                                text = stringResource(R.string.action_refresh),
                                style = MaterialTheme.typography.labelMedium
                            )
                        }
                    }
                }

                connectionError?.let { error ->
                    Snackbar(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(16.dp),
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                        contentColor = MaterialTheme.colorScheme.onErrorContainer,
                        action = {
                            TextButton(onClick = onNavigateToSettings) {
                                Text(stringResource(R.string.settings))
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
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onToggleConnection: () -> Unit,
    onOpenSettings: () -> Unit
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
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            ConnectionStatusBadge(connectionState)
        }

        Surface(
            color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
            contentColor = MaterialTheme.colorScheme.onSurface,
            shape = RoundedCornerShape(18.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.14f)),
            shadowElevation = 5.dp
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
                HeaderActionButton(
                    icon = Icons.Default.Settings,
                    contentDescription = stringResource(R.string.settings),
                    enabled = true,
                    tint = MaterialTheme.colorScheme.onSurface,
                    onClick = onOpenSettings
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
private fun SessionCard(session: Session, onClick: () -> Unit) {
    val avatar = session.name.firstOrNull()?.uppercase() ?: "C"

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.97f),
            contentColor = MaterialTheme.colorScheme.onSurface
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.14f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = if (session.isAgentOnline) {
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
                        color = if (session.isAgentOnline) {
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
                        text = session.name,
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    SummaryPill(
                        text = runtimeLabel(session),
                        containerColor = runtimeColor(session).copy(alpha = 0.14f),
                        contentColor = runtimeColor(session)
                    )
                }

                Text(
                    text = session.projectPath,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(
                        text = "${providerLabel(session.cliProvider)} / ${modelLabel(session.cliModel)}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(
                                if (session.isAgentOnline) Color(0xFF4CAF50) else Color(0xFFEF5350)
                            )
                    )
                    Text(
                        text = stringResource(R.string.agent_prefix, session.agentId.take(8)),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
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
