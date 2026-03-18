package com.claudecode.remote.ui.session

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudecode.remote.R
import com.claudecode.remote.data.model.Session
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    viewModel: SessionViewModel,
    webSocket: com.claudecode.remote.data.remote.RelayWebSocket,
    onNavigateToChat: (sessionId: String) -> Unit,
    onNavigateToSettings: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    val connectionState by webSocket.connectionState.collectAsState()
    val connectionError by webSocket.errorMessage.collectAsState()
    var showAddDialog by remember { mutableStateOf(false) }
    var serverUrlInput by remember { mutableStateOf(uiState.serverUrl) }

    LaunchedEffect(Unit) {
        if (uiState.serverUrl.isEmpty()) {
            serverUrlInput = "http://192.168.31.207:8080"
            viewModel.initialize(serverUrlInput)
        }
        // Auto-connect on start
        webSocket.connect()
    }

    Scaffold(
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
                    // Connection toggle button
                    IconButton(
                        onClick = {
                            when (connectionState) {
                                com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTED,
                                com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTING,
                                com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.RECONNECTING -> {
                                    webSocket.disconnect()
                                }
                                com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.DISCONNECTED -> {
                                    CoroutineScope(Dispatchers.Main).launch {
                                        webSocket.connect()
                                    }
                                }
                            }
                        }
                    ) {
                        Icon(
                            imageVector = when (connectionState) {
                                com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTED ->
                                    Icons.Default.Close
                                com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.DISCONNECTED ->
                                    Icons.Default.Refresh
                                else -> Icons.Default.Refresh
                            },
                            contentDescription = "Toggle connection",
                            tint = when (connectionState) {
                                com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTED ->
                                    Color(0xFF4CAF50)
                                else -> MaterialTheme.colorScheme.onSurface
                            }
                        )
                    }
                    IconButton(onClick = onNavigateToSettings) {
                        Icon(Icons.Default.Settings, contentDescription = stringResource(R.string.settings))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primaryContainer
                )
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { showAddDialog = true }) {
                Icon(Icons.Default.Add, contentDescription = stringResource(R.string.add_session))
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            if (uiState.isLoading) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else if (uiState.sessions.isEmpty()) {
                Text(
                    text = stringResource(R.string.no_sessions),
                    modifier = Modifier.align(Alignment.Center),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                    items(uiState.sessions, key = { it.id }) { session ->
                        SessionCard(
                            session = session,
                            onClick = { onNavigateToChat(session.id) },
                            onDelete = { viewModel.removeSession(session.id) }
                        )
                    }
                }
            }

            // Show connection error
            connectionError?.let { error ->
                Snackbar(
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer,
                    action = {
                        TextButton(onClick = onNavigateToSettings) {
                            Text("设置")
                        }
                    }
                ) {
                    Text(error)
                }
            }

            // Show session error
            uiState.error?.let { error ->
                Snackbar(
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp).padding(bottom = 60.dp),
                    action = {
                        TextButton(onClick = { viewModel.clearError() }) { Text(stringResource(R.string.dismiss)) }
                    }
                ) { Text(error) }
            }

            connectionError?.let { error ->
                Snackbar(
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    contentColor = MaterialTheme.colorScheme.onErrorContainer
                ) { Text(error) }
            }
        }
    }

    if (showAddDialog) {
        AddSessionDialog(
            onConfirm = { agentId, projectId, path, name ->
                viewModel.addSession(agentId, projectId, path, name)
                showAddDialog = false
            },
            onDismiss = { showAddDialog = false }
        )
    }
}

@Composable
private fun SessionCard(session: Session, onClick: () -> Unit, onDelete: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier.padding(16.dp).fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Online status indicator
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .padding(end = 0.dp)
            ) {
                Surface(
                    modifier = Modifier.size(10.dp),
                    shape = MaterialTheme.shapes.small,
                    color = Color(0xFF4CAF50)
                ) {}
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = session.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = session.projectPath,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
              text = stringResource(R.string.agent_prefix, session.agentId.take(8)),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = stringResource(R.string.delete_session),
                    tint = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

@Composable
private fun ConnectionStatusBadge(state: com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState) {
    val (color, text) = when (state) {
        com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTED ->
            Color(0xFF4CAF50) to "已连接"
        com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.CONNECTING ->
            Color(0xFFFFA726) to "连接中"
        com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.RECONNECTING ->
            Color(0xFFFFA726) to "重连中"
        com.claudecode.remote.data.remote.RelayWebSocket.ConnectionState.DISCONNECTED ->
            Color(0xFFEF5350) to "未连接"
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        modifier = Modifier
            .background(color.copy(alpha = 0.2f), shape = MaterialTheme.shapes.small)
            .padding(horizontal = 8.dp, vertical = 4.dp)
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

@Composable
private fun AddSessionDialog(
    onConfirm: (agentId: String, projectId: String, path: String, name: String) -> Unit,
    onDismiss: () -> Unit
) {
    var agentId by remember { mutableStateOf("") }
    var projectId by remember { mutableStateOf("") }
    var path by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.add_session)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text(stringResource(R.string.session_name_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = agentId,
                    onValueChange = { agentId = it },
                    label = { Text(stringResource(R.string.agent_id_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = projectId,
                    onValueChange = { projectId = it },
                    label = { Text(stringResource(R.string.project_id_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = path,
                    onValueChange = { path = it },
                    label = { Text(stringResource(R.string.project_path_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (agentId.isNotBlank() && projectId.isNotBlank() && path.isNotBlank() && name.isNotBlank()) {
                        onConfirm(agentId.trim(), projectId.trim(), path.trim(), name.trim())
                    }
                }
            ) { Text(stringResource(R.string.add)) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        }
    )
}
