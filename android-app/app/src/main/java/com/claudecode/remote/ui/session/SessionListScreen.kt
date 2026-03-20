package com.claudecode.remote.ui.session

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudecode.remote.R
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.remote.RelayWebSocket
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    viewModel: SessionViewModel,
    webSocket: RelayWebSocket,
    onNavigateToChat: (session: Session) -> Unit,
    onNavigateToSettings: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by webSocket.connectionState.collectAsState()
    val connectionError by webSocket.errorMessage.collectAsState()
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        if (uiState.serverUrl.isEmpty()) {
            viewModel.initialize("http://192.168.31.207:8080")
        }
        webSocket.connect()
    }

    LaunchedEffect(connectionState) {
        if (connectionState == RelayWebSocket.ConnectionState.CONNECTED) {
            viewModel.syncFromDesktop()
        }
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
            topBar = {
                TopAppBar(
                    title = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(stringResource(R.string.app_name))
                            ConnectionStatusBadge(connectionState)
                        }
                    },
                    actions = {
                        IconButton(
                            onClick = { viewModel.syncFromDesktop() },
                            enabled = connectionState == RelayWebSocket.ConnectionState.CONNECTED
                        ) {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = stringResource(R.string.action_refresh)
                            )
                        }
                        IconButton(
                            onClick = {
                                when (connectionState) {
                                    RelayWebSocket.ConnectionState.CONNECTED,
                                    RelayWebSocket.ConnectionState.CONNECTING,
                                    RelayWebSocket.ConnectionState.RECONNECTING -> webSocket.disconnect()
                                    RelayWebSocket.ConnectionState.DISCONNECTED -> {
                                        coroutineScope.launch {
                                            webSocket.connect()
                                        }
                                    }
                                }
                            }
                        ) {
                            Icon(
                                imageVector = when (connectionState) {
                                    RelayWebSocket.ConnectionState.CONNECTED -> Icons.Default.Close
                                    else -> Icons.Default.Refresh
                                },
                                contentDescription = stringResource(R.string.action_toggle_connection),
                                tint = if (connectionState == RelayWebSocket.ConnectionState.CONNECTED) {
                                    Color(0xFF4CAF50)
                                } else {
                                    MaterialTheme.colorScheme.onSurface
                                }
                            )
                        }
                        IconButton(onClick = onNavigateToSettings) {
                            Icon(
                                Icons.Default.Settings,
                                contentDescription = stringResource(R.string.settings)
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = Color.Transparent
                    )
                )
            }
        ) { padding ->
            Box(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    SessionOverviewCard(
                        connectionState = connectionState,
                        sessions = uiState.sessions
                    )

                    when {
                        uiState.isLoading -> {
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
                                contentPadding = PaddingValues(bottom = 20.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp)
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
private fun SessionOverviewCard(
    connectionState: RelayWebSocket.ConnectionState,
    sessions: List<Session>
) {
    val runningCount = sessions.count { it.isRunning }
    val queuedCount = sessions.count { it.queuedCount > 0 }

    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        shadowElevation = 10.dp,
        tonalElevation = 3.dp,
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = stringResource(R.string.app_name),
                        style = MaterialTheme.typography.titleLarge
                    )
                    Text(
                        text = stringResource(R.string.session_synced_summary),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Spacer(modifier = Modifier.width(12.dp))
                ConnectionStatusBadge(connectionState)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SummaryPill(
                    text = stringResource(R.string.session_projects_count, sessions.size),
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                )
                SummaryPill(
                    text = stringResource(R.string.session_running_count, runningCount),
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.onSecondaryContainer
                )
                if (queuedCount > 0) {
                    SummaryPill(
                        text = stringResource(R.string.session_queued_count, queuedCount),
                        containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                        contentColor = MaterialTheme.colorScheme.onTertiaryContainer
                    )
                }
            }
        }
    }
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
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
        )
    }
}

@Composable
private fun SessionCard(session: Session, onClick: () -> Unit) {
    val avatar = session.name.firstOrNull()?.uppercase() ?: "C"

    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(26.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f)
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 4.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(18.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = if (session.isAgentOnline) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.errorContainer
                },
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.size(48.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = avatar,
                        style = MaterialTheme.typography.titleMedium,
                        color = if (session.isAgentOnline) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onErrorContainer
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.width(14.dp))

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = session.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    SummaryPill(
                        text = runtimeLabel(session),
                        containerColor = runtimeColor(session).copy(alpha = 0.14f),
                        contentColor = runtimeColor(session)
                    )
                }

                Text(
                    text = session.projectPath,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Text(
                    text = "${providerLabel(session.cliProvider)} / ${modelLabel(session.cliModel)}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(
                                if (session.isAgentOnline) Color(0xFF4CAF50) else Color(0xFFEF5350)
                            )
                    )
                    Text(
                        text = stringResource(R.string.agent_prefix, session.agentId.take(8)),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
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
            .background(color.copy(alpha = 0.16f), shape = RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp)
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(color)
        )
        Text(
            text = text,
            fontSize = 12.sp,
            color = color,
            fontWeight = FontWeight.Medium
        )
    }
}
