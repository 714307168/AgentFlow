package com.claudecode.remote.ui.workgroup

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.FilledIconButton
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import com.claudecode.remote.R
import com.claudecode.remote.data.model.WorkgroupMember
import com.claudecode.remote.data.model.WorkgroupMessage

@Composable
fun WorkgroupChatScreen(
    agentId: String,
    workgroupId: String,
    workgroupName: String,
    viewModel: WorkgroupChatViewModel,
    onNavigateBack: () -> Unit
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val lifecycleOwner = context as? LifecycleOwner
    var previousLastMessageId by remember(agentId, workgroupId) { mutableStateOf<String?>(null) }
    var previousMessageCount by remember(agentId, workgroupId) { mutableStateOf(0) }
    var resumeScrollRequestToken by remember(agentId, workgroupId) { mutableStateOf(0) }
    var handledResumeScrollToken by remember(agentId, workgroupId) { mutableStateOf(0) }

    LaunchedEffect(agentId, workgroupId, workgroupName) {
        viewModel.loadWorkgroup(agentId, workgroupId, workgroupName)
    }

    DisposableEffect(lifecycleOwner, agentId, workgroupId) {
        if (lifecycleOwner == null) {
            onDispose { }
        } else {
            val observer = LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) {
                    resumeScrollRequestToken += 1
                }
            }
            lifecycleOwner.lifecycle.addObserver(observer)
            onDispose {
                lifecycleOwner.lifecycle.removeObserver(observer)
            }
        }
    }

    val lastMessage = uiState.messages.lastOrNull()
    LaunchedEffect(lastMessage?.id, lastMessage?.content, uiState.messages.size, resumeScrollRequestToken) {
        if (uiState.messages.isEmpty()) {
            previousLastMessageId = null
            previousMessageCount = 0
            return@LaunchedEffect
        }

        val lastIndex = uiState.messages.lastIndex
        val lastVisibleIndex = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: lastIndex
        val isNearBottom = lastVisibleIndex >= lastIndex - 1
        val hasAppendedMessage =
            uiState.messages.size > previousMessageCount || lastMessage?.id != previousLastMessageId
        val shouldForceLatestOnResume = resumeScrollRequestToken != handledResumeScrollToken

        when {
            previousMessageCount == 0 || shouldForceLatestOnResume -> {
                listState.scrollToItem(lastIndex)
                handledResumeScrollToken = resumeScrollRequestToken
            }
            isNearBottom && hasAppendedMessage -> listState.animateScrollToItem(lastIndex)
            lastMessage?.status == "streaming" && isNearBottom -> listState.scrollToItem(lastIndex)
        }

        previousLastMessageId = lastMessage?.id
        previousMessageCount = uiState.messages.size
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.background,
                        MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.24f),
                        MaterialTheme.colorScheme.surface
                    )
                )
            )
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            bottomBar = {
                WorkgroupInputBar(
                    text = uiState.inputText,
                    mentionSuggestions = uiState.mentionSuggestions,
                    enabled = uiState.isConnected && !uiState.isSending,
                    onTextChange = viewModel::updateInput,
                    onApplyMention = viewModel::applyMentionSuggestion,
                    onSend = viewModel::sendMessage
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
                        .statusBarsPadding()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    WorkgroupChatHeader(
                        uiState = uiState,
                        onNavigateBack = onNavigateBack,
                        onRefresh = viewModel::refresh
                    )

                    Surface(
                        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                        shape = RoundedCornerShape(20.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
                        modifier = Modifier.fillMaxSize()
                    ) {
                        if (uiState.isLoading && uiState.messages.isEmpty()) {
                            Box(
                                modifier = Modifier.fillMaxSize(),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = stringResource(R.string.workgroups_loading_chat),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        } else if (uiState.messages.isEmpty()) {
                            Box(
                                modifier = Modifier.fillMaxSize(),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = stringResource(R.string.workgroups_no_messages),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        } else {
                            LazyColumn(
                                state = listState,
                                modifier = Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                item(key = "history-header") {
                                    if (uiState.hasMoreHistory) {
                                        TextButton(
                                            onClick = { viewModel.loadOlderMessages() },
                                            enabled = !uiState.isLoadingOlder,
                                            modifier = Modifier.fillMaxWidth()
                                        ) {
                                            Text(
                                                text = if (uiState.isLoadingOlder) {
                                                    stringResource(R.string.chat_loading_older_safe)
                                                } else {
                                                    stringResource(R.string.workgroups_load_older)
                                                }
                                            )
                                        }
                                    }
                                }
                                items(uiState.messages, key = { it.id }) { message ->
                                    WorkgroupMessageBubble(message = message)
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
private fun WorkgroupChatHeader(
    uiState: WorkgroupChatUiState,
    onNavigateBack: () -> Unit,
    onRefresh: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            IconButton(onClick = onNavigateBack) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = stringResource(R.string.back)
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = uiState.workgroupName,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = stringResource(R.string.workgroups_agent_label, uiState.agentId),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            IconButton(onClick = onRefresh, enabled = uiState.isConnected && !uiState.isLoading) {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = stringResource(R.string.action_refresh)
                )
            }
        }

        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(horizontal = 2.dp)
        ) {
            item("status") {
                HeaderChip(
                    text = if (uiState.isRunning) stringResource(R.string.status_running) else stringResource(R.string.status_ready),
                    containerColor = if (uiState.isRunning) MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = if (uiState.isRunning) MaterialTheme.colorScheme.onTertiaryContainer else MaterialTheme.colorScheme.onSecondaryContainer
                )
            }
            item("members") {
                HeaderChip(
                    text = stringResource(R.string.workgroups_members_count, uiState.members.size),
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            item("connection") {
                HeaderChip(
                    text = if (uiState.isConnected) stringResource(R.string.status_connected) else stringResource(R.string.status_offline),
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            items(uiState.members, key = { it.id }) { member ->
                Surface(
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.78f),
                    shape = RoundedCornerShape(999.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.1f))
                ) {
                    Text(
                        text = member.name + roleSuffix(member),
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
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
private fun HeaderChip(
    text: String,
    containerColor: Color,
    contentColor: Color
) {
    Surface(
        color = containerColor,
        contentColor = contentColor,
        shape = RoundedCornerShape(999.dp)
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold
        )
    }
}

@Composable
private fun WorkgroupMessageBubble(message: WorkgroupMessage) {
    val isUser = message.senderType == "user"
    val isSystem = message.senderType == "system"
    val isError = message.senderType == "error"

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = when {
            isUser -> Arrangement.End
            isSystem -> Arrangement.Center
            else -> Arrangement.Start
        }
    ) {
        Surface(
            color = when {
                isUser -> MaterialTheme.colorScheme.primary
                isError -> MaterialTheme.colorScheme.errorContainer
                isSystem -> MaterialTheme.colorScheme.surfaceVariant
                else -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.72f)
            },
            contentColor = when {
                isUser -> MaterialTheme.colorScheme.onPrimary
                isError -> MaterialTheme.colorScheme.onErrorContainer
                else -> MaterialTheme.colorScheme.onSurface
            },
            shape = RoundedCornerShape(
                topStart = 18.dp,
                topEnd = 18.dp,
                bottomStart = if (isUser) 18.dp else 6.dp,
                bottomEnd = if (isUser) 6.dp else 18.dp
            ),
            tonalElevation = if (message.status == "streaming") 3.dp else 0.dp,
            modifier = Modifier.fillMaxWidth(0.9f)
        ) {
            Column(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                if (!isUser) {
                    Text(
                        text = buildSenderLabel(message),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(
                    text = message.content.ifBlank {
                        if (message.status == "streaming") stringResource(R.string.chat_thinking) else ""
                    },
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    text = formatTimestamp(message.updatedAt.takeIf { it > 0L } ?: message.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun WorkgroupInputBar(
    text: String,
    mentionSuggestions: List<WorkgroupMentionSuggestion>,
    enabled: Boolean,
    onTextChange: (String) -> Unit,
    onApplyMention: (WorkgroupMentionSuggestion) -> Unit,
    onSend: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
        tonalElevation = 6.dp,
        shadowElevation = 6.dp,
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .imePadding()
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (mentionSuggestions.isNotEmpty()) {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(horizontal = 2.dp)
                ) {
                    items(mentionSuggestions, key = { it.label }) { suggestion ->
                        TextButton(
                            onClick = { onApplyMention(suggestion) },
                            enabled = enabled
                        ) {
                            Text("${suggestion.label} ${suggestion.meta}", maxLines = 1)
                        }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedTextField(
                    value = text,
                    onValueChange = onTextChange,
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(stringResource(R.string.workgroups_message_hint)) },
                    enabled = enabled,
                    maxLines = 5,
                    shape = RoundedCornerShape(22.dp)
                )
                FilledIconButton(
                    onClick = onSend,
                    enabled = enabled && text.trim().isNotEmpty(),
                    modifier = Modifier.size(48.dp)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = stringResource(R.string.send_message)
                    )
                }
            }
        }
    }
}

private fun roleSuffix(member: WorkgroupMember): String =
    member.role.trim().takeIf { it.isNotEmpty() }?.let { " / $it" } ?: ""

private fun buildSenderLabel(message: WorkgroupMessage): String =
    listOfNotNull(
        message.senderName.takeIf { it.isNotBlank() },
        message.memberRole?.takeIf { it.isNotBlank() }
    ).joinToString(separator = " / ")

private fun formatTimestamp(timestamp: Long): String {
    if (timestamp <= 0L) {
        return ""
    }
    val formatter = java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.getDefault())
    return formatter.format(java.util.Date(timestamp))
}
