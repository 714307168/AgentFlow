package com.claudecode.remote.ui.chat

import android.net.Uri
import androidx.compose.animation.animateContentSize
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.claudecode.remote.R
import com.claudecode.remote.UiPresenceTracker
import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.model.MessageRole
import com.claudecode.remote.data.model.MessageType
import kotlinx.coroutines.launch

@Composable
fun ChatScreen(
    projectId: String,
    projectName: String,
    agentId: String,
    viewModel: ChatViewModel,
    uiPresenceTracker: UiPresenceTracker,
    onNavigateBack: () -> Unit
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    var showModelDialog by remember { mutableStateOf(false) }
    var modelInput by remember { mutableStateOf("") }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let { viewModel.sendFile(it) }
    }

    LaunchedEffect(projectId) {
        if (projectId.isNotEmpty()) {
            viewModel.loadProject(projectId, projectName, agentId)
        }
    }

    DisposableEffect(projectId) {
        uiPresenceTracker.setActiveProject(projectId)
        onDispose {
            uiPresenceTracker.setActiveProject(null)
        }
    }

    val lastMessage = uiState.messages.lastOrNull()
    LaunchedEffect(lastMessage?.id, lastMessage?.content, lastMessage?.isStreaming, uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            coroutineScope.launch {
                listState.animateScrollToItem(uiState.messages.size - 1)
            }
        }
    }

    if (showModelDialog) {
        AlertDialog(
            onDismissRequest = { showModelDialog = false },
            title = { Text(stringResource(R.string.chat_switch_model_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = stringResource(R.string.chat_provider_label, providerLabel(uiState.cliProvider)),
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = stringResource(R.string.chat_current_model_label, modelLabel(uiState.cliModel)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedTextField(
                        value = modelInput,
                        onValueChange = { modelInput = it },
                        label = { Text(stringResource(R.string.chat_model_field)) },
                        placeholder = { Text(stringResource(R.string.chat_model_placeholder)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.changeModel(modelInput)
                        showModelDialog = false
                    }
                ) {
                    Text(stringResource(R.string.settings_apply))
                }
            },
            dismissButton = {
                TextButton(onClick = { showModelDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        MaterialTheme.colorScheme.background,
                        MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.28f),
                        MaterialTheme.colorScheme.surface
                    )
                )
            )
    ) {
        Scaffold(
            containerColor = Color.Transparent,
            bottomBar = {
                InputBar(
                    text = uiState.inputText,
                    onTextChange = { viewModel.updateInput(it) },
                    onSend = { viewModel.sendMessage() },
                    onStop = { viewModel.stopTask() },
                    onAttachFile = { filePickerLauncher.launch("*/*") },
                    enabled = uiState.isConnected && !uiState.isSending,
                    isRunning = uiState.isRunning
                )
            }
        ) { padding ->
            Column(
                modifier = Modifier
                    .padding(padding)
                    .statusBarsPadding()
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ChatHeader(
                    title = uiState.projectName.ifEmpty { projectName },
                    provider = providerLabel(uiState.cliProvider),
                    model = modelLabel(uiState.cliModel),
                    isConnected = uiState.isConnected,
                    runtimeText = runtimeLabel(uiState),
                    runtimeTone = runtimeColor(uiState),
                    onNavigateBack = onNavigateBack,
                    onChangeModel = {
                        modelInput = uiState.cliModel
                        showModelDialog = true
                    },
                    modelEnabled = uiState.isConnected && !uiState.isSending
                )

                Surface(
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                    shape = RoundedCornerShape(24.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
                    shadowElevation = 6.dp,
                    modifier = Modifier.fillMaxSize()
                ) {
                    Column(modifier = Modifier.fillMaxSize()) {
                        if (shouldShowRuntimeBanner(uiState)) {
                            RuntimeNoticeBanner(uiState = uiState)
                        }

                        if (uiState.messages.isEmpty()) {
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(horizontal = 18.dp, vertical = 14.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = stringResource(R.string.no_messages),
                                    style = MaterialTheme.typography.bodyMedium,
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
                                items(uiState.messages, key = { it.id }) { message ->
                                    MessageBubble(message = message)
                                }
                            }
                        }
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
private fun connectionLabel(isConnected: Boolean): String =
    if (isConnected) stringResource(R.string.status_connected) else stringResource(R.string.status_offline)

@Composable
private fun runtimeLabel(uiState: ChatUiState): String =
    when {
        !uiState.isAgentOnline -> stringResource(R.string.status_agent_offline)
        uiState.isRunning -> stringResource(R.string.status_running)
        uiState.queuedCount > 0 -> stringResource(R.string.status_queued, uiState.queuedCount)
        else -> stringResource(R.string.status_ready)
    }

@Composable
private fun runtimeColor(uiState: ChatUiState): Color =
    when {
        !uiState.isAgentOnline -> MaterialTheme.colorScheme.error
        uiState.isRunning -> MaterialTheme.colorScheme.tertiary
        uiState.queuedCount > 0 -> MaterialTheme.colorScheme.tertiary
        else -> MaterialTheme.colorScheme.secondary
    }

private fun shouldShowRuntimeBanner(uiState: ChatUiState): Boolean =
    !uiState.isAgentOnline || uiState.isRunning || uiState.queuedCount > 0

@Composable
private fun runtimeBannerSummary(uiState: ChatUiState): String =
    when {
        !uiState.isAgentOnline -> uiState.currentPrompt?.trim().takeUnless { it.isNullOrEmpty() }
            ?: uiState.queuePreview?.trim().takeUnless { it.isNullOrEmpty() }
            ?: stringResource(R.string.chat_runtime_offline_detail)
        uiState.isRunning -> uiState.currentPrompt?.trim().takeUnless { it.isNullOrEmpty() }
            ?: stringResource(R.string.chat_runtime_running_detail)
        uiState.queuedCount > 0 -> uiState.queuePreview?.trim().takeUnless { it.isNullOrEmpty() }
            ?: stringResource(R.string.chat_runtime_queued_detail, uiState.queuedCount)
        else -> stringResource(R.string.status_ready)
    }.lineSequence().firstOrNull()?.trim().orEmpty()

@Composable
private fun ChatHeader(
    title: String,
    provider: String,
    model: String,
    isConnected: Boolean,
    runtimeText: String,
    runtimeTone: Color,
    onNavigateBack: () -> Unit,
    onChangeModel: () -> Unit,
    modelEnabled: Boolean
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        ChatHeaderButton(
            icon = Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = stringResource(R.string.back),
            enabled = true,
            tint = MaterialTheme.colorScheme.onSurface,
            onClick = onNavigateBack
        )

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RuntimePill(
                    text = connectionLabel(isConnected),
                    color = if (isConnected) Color(0xFF4CAF50) else Color(0xFFEF5350)
                )
                RuntimePill(
                    text = runtimeText,
                    color = runtimeTone
                )
                Text(
                    text = "$provider / $model",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
            }
        }

        ChatHeaderButton(
            icon = Icons.Default.AutoAwesome,
            contentDescription = stringResource(R.string.action_model),
            enabled = modelEnabled,
            tint = MaterialTheme.colorScheme.primary,
            onClick = onChangeModel
        )
    }
}

@Composable
private fun ChatHeaderButton(
    icon: ImageVector,
    contentDescription: String,
    enabled: Boolean,
    tint: Color,
    onClick: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.14f)),
        shadowElevation = 4.dp
    ) {
        IconButton(
            onClick = onClick,
            enabled = enabled,
            modifier = Modifier.size(42.dp),
            colors = IconButtonDefaults.iconButtonColors(
                contentColor = tint,
                disabledContentColor = MaterialTheme.colorScheme.outline
            )
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription
            )
        }
    }
}

@Composable
private fun RuntimePill(text: String, color: Color) {
    Surface(
        color = color.copy(alpha = 0.12f),
        shape = RoundedCornerShape(999.dp),
        border = BorderStroke(1.dp, color.copy(alpha = 0.14f))
    ) {
        Text(
            text = text,
            color = color,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
        )
    }
}

@Composable
private fun RuntimeNoticeBanner(uiState: ChatUiState) {
    var expanded by rememberSaveable(
        uiState.projectId,
        uiState.isAgentOnline,
        uiState.isRunning,
        uiState.queuedCount,
        uiState.currentPrompt,
        uiState.queuePreview
    ) {
        mutableStateOf(false)
    }

    val detail = when {
        !uiState.isAgentOnline -> stringResource(R.string.chat_runtime_offline_detail)
        uiState.isRunning -> uiState.currentPrompt?.trim().takeUnless { it.isNullOrEmpty() }
            ?: stringResource(R.string.chat_runtime_running_detail)
        uiState.queuedCount > 0 -> uiState.queuePreview?.trim().takeUnless { it.isNullOrEmpty() }
            ?: stringResource(R.string.chat_runtime_queued_detail, uiState.queuedCount)
        else -> stringResource(R.string.chat_runtime_ready_detail)
    }

    val tone = when {
        !uiState.isAgentOnline -> MaterialTheme.colorScheme.errorContainer
        uiState.isRunning -> MaterialTheme.colorScheme.secondaryContainer
        uiState.queuedCount > 0 -> MaterialTheme.colorScheme.tertiaryContainer
        else -> MaterialTheme.colorScheme.primaryContainer
    }
    val textColor = when {
        !uiState.isAgentOnline -> MaterialTheme.colorScheme.onErrorContainer
        uiState.isRunning -> MaterialTheme.colorScheme.onSecondaryContainer
        uiState.queuedCount > 0 -> MaterialTheme.colorScheme.onTertiaryContainer
        else -> MaterialTheme.colorScheme.onPrimaryContainer
    }

    Surface(
        color = tone,
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 10.dp, end = 10.dp, top = 10.dp)
            .animateContentSize(),
        shape = RoundedCornerShape(16.dp),
        shadowElevation = 2.dp,
        border = BorderStroke(1.dp, textColor.copy(alpha = 0.12f))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                RuntimePill(
                    text = runtimeLabel(uiState),
                    color = textColor
                )
                Text(
                    text = runtimeBannerSummary(uiState),
                    style = MaterialTheme.typography.bodySmall,
                    color = textColor.copy(alpha = 0.92f),
                    maxLines = if (expanded) 3 else 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    imageVector = if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
                    contentDescription = stringResource(
                        if (expanded) R.string.chat_runtime_collapse else R.string.chat_runtime_expand
                    ),
                    tint = textColor.copy(alpha = 0.88f)
                )
            }

            if (expanded) {
                Text(
                    text = detail,
                    style = MaterialTheme.typography.labelMedium,
                    color = textColor.copy(alpha = 0.86f)
                )
            }
        }
    }
}

@Composable
private fun MessageBubble(message: Message) {
    val isUser = message.role == MessageRole.USER
    val isThinking = message.type == MessageType.THINKING
    val bubbleColor = when {
        isUser -> MaterialTheme.colorScheme.primary.copy(alpha = 0.92f)
        isThinking -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.94f)
        else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.44f)
    }
    val textColor = when {
        isUser -> MaterialTheme.colorScheme.onPrimary
        isThinking -> MaterialTheme.colorScheme.onSecondaryContainer
        else -> MaterialTheme.colorScheme.onSurface
    }
    val borderColor = when {
        isUser -> MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)
        isThinking -> MaterialTheme.colorScheme.secondary.copy(alpha = 0.16f)
        else -> MaterialTheme.colorScheme.outline.copy(alpha = 0.14f)
    }
    val alignment = if (isUser) Alignment.End else Alignment.Start

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = alignment
    ) {
        Surface(
            shape = RoundedCornerShape(
                topStart = 18.dp,
                topEnd = 18.dp,
                bottomStart = if (isUser) 18.dp else 6.dp,
                bottomEnd = if (isUser) 6.dp else 18.dp
            ),
            color = bubbleColor,
            tonalElevation = if (isUser) 0.dp else 2.dp,
            shadowElevation = if (isUser) 2.dp else 3.dp,
            border = BorderStroke(1.dp, borderColor),
            modifier = Modifier.widthIn(max = 332.dp)
        ) {
            if (message.type == MessageType.FILE) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.InsertDriveFile,
                        contentDescription = stringResource(R.string.chat_file),
                        tint = textColor,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f, fill = false)) {
                        Text(
                            text = message.content,
                            color = textColor,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Medium
                        )
                        message.fileInfo?.let { fileInfo ->
                            Text(
                                text = "${fileInfo.fileSize / 1024} KB",
                                color = textColor.copy(alpha = 0.7f),
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            } else {
                Column(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    if (isThinking) {
                        Text(
                            text = stringResource(R.string.chat_thinking),
                            color = textColor.copy(alpha = 0.8f),
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            text = message.content,
                            color = textColor,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontStyle = if (isThinking) FontStyle.Italic else FontStyle.Normal
                            ),
                            fontFamily = FontFamily.Default,
                            fontWeight = if (isUser) FontWeight.Medium else FontWeight.Normal,
                            modifier = Modifier.weight(1f, fill = false)
                        )
                        if (message.isStreaming) {
                            Spacer(modifier = Modifier.width(4.dp))
                            BlinkingCursor(color = textColor)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BlinkingCursor(color: Color) {
    val infiniteTransition = rememberInfiniteTransition(label = "cursor")
    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(500),
            repeatMode = RepeatMode.Reverse
        ),
        label = "cursorAlpha"
    )
    Text(
        text = "|",
        color = color,
        modifier = Modifier.alpha(alpha),
        style = MaterialTheme.typography.bodyMedium
    )
}

@Composable
private fun InputBar(
    text: String,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onAttachFile: () -> Unit,
    enabled: Boolean,
    isRunning: Boolean
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.98f),
        tonalElevation = 4.dp,
        shadowElevation = 8.dp,
        shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .navigationBarsPadding()
                .imePadding(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
            ) {
                IconButton(
                    onClick = onAttachFile,
                    enabled = enabled && !isRunning,
                    modifier = Modifier.size(40.dp)
                ) {
                    Icon(
                        Icons.Default.AttachFile,
                        contentDescription = stringResource(R.string.chat_attach_file),
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }
            }
            Spacer(modifier = Modifier.width(8.dp))
            OutlinedTextField(
                value = text,
                onValueChange = onTextChange,
                placeholder = {
                    Text(
                        text = stringResource(R.string.message_hint),
                        style = MaterialTheme.typography.bodySmall
                    )
                },
                modifier = Modifier.weight(1f),
                enabled = enabled && !isRunning,
                maxLines = 4,
                shape = RoundedCornerShape(22.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                    disabledContainerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.2f),
                    focusedBorderColor = MaterialTheme.colorScheme.primary,
                    unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.32f),
                    disabledBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.16f),
                    focusedTextColor = MaterialTheme.colorScheme.onSurface,
                    unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                    disabledTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    focusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant,
                    unfocusedPlaceholderColor = MaterialTheme.colorScheme.onSurfaceVariant
                )
            )
            Spacer(modifier = Modifier.width(8.dp))
            if (isRunning) {
                FilledIconButton(
                    onClick = onStop,
                    enabled = enabled,
                    modifier = Modifier.size(44.dp),
                    colors = androidx.compose.material3.IconButtonDefaults.filledIconButtonColors(
                        containerColor = MaterialTheme.colorScheme.error
                    )
                ) {
                    Icon(
                        Icons.Default.Stop,
                        contentDescription = stringResource(R.string.chat_stop_task)
                    )
                }
            } else {
                FilledIconButton(
                    onClick = onSend,
                    enabled = enabled && text.isNotBlank(),
                    modifier = Modifier.size(44.dp)
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = stringResource(R.string.send_message)
                    )
                }
            }
        }
    }
}
