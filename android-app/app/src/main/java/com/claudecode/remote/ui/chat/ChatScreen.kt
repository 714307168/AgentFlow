package com.claudecode.remote.ui.chat

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.animation.animateContentSize
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
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
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.core.content.FileProvider
import com.claudecode.remote.R
import com.claudecode.remote.UiPresenceTracker
import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.model.MessageAttachment
import com.claudecode.remote.data.model.MessageRole
import com.claudecode.remote.data.model.MessageType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private data class AttachmentPreviewTarget(
    val messageId: String,
    val attachment: MessageAttachment
)

@Composable
fun ChatScreen(
    projectId: String,
    projectName: String,
    agentId: String,
    viewModel: ChatViewModel,
    uiPresenceTracker: UiPresenceTracker,
    onNavigateBack: () -> Unit
) {
    val context = LocalContext.current
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    var showModelDialog by remember { mutableStateOf(false) }
    var modelInput by remember { mutableStateOf("") }
    var hasInitialScrollPosition by remember(projectId) { mutableStateOf(false) }
    var previousLastMessageId by remember(projectId) { mutableStateOf<String?>(null) }
    var previousMessageCount by remember(projectId) { mutableStateOf(0) }
    var previewAttachment by remember(projectId) { mutableStateOf<AttachmentPreviewTarget?>(null) }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris: List<Uri> ->
        if (uris.isNotEmpty()) {
            viewModel.addAttachments(uris)
        }
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
        if (uiState.messages.isEmpty()) {
            hasInitialScrollPosition = false
            previousLastMessageId = null
            previousMessageCount = 0
            return@LaunchedEffect
        }

        val lastIndex = uiState.messages.lastIndex
        val lastVisibleIndex = listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: lastIndex
        val isNearBottom = lastVisibleIndex >= lastIndex - 1
        val hasAppendedMessage =
            uiState.messages.size > previousMessageCount || lastMessage?.id != previousLastMessageId

        when {
            !hasInitialScrollPosition -> {
                listState.scrollToItem(lastIndex)
                hasInitialScrollPosition = true
            }
            !isNearBottom -> Unit
            hasAppendedMessage -> {
                coroutineScope.launch {
                    listState.animateScrollToItem(lastIndex)
                }
            }
            lastMessage?.isStreaming == true -> {
                listState.scrollToItem(lastIndex)
            }
        }

        previousLastMessageId = lastMessage?.id
        previousMessageCount = uiState.messages.size
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

    val activePreviewAttachment = previewAttachment?.let { target ->
        uiState.messages
            .firstOrNull { it.id == target.messageId }
            ?.attachments
            ?.firstOrNull { it.id == target.attachment.id }
            ?.let { latestAttachment ->
                AttachmentPreviewTarget(
                    messageId = target.messageId,
                    attachment = latestAttachment
                )
            }
            ?: target
    }

    activePreviewAttachment?.let { target ->
        AttachmentPreviewDialog(
            attachment = target.attachment,
            actionLabel = attachmentActionLabel(
                attachment = target.attachment,
                isDownloading = target.attachment.id in uiState.downloadingAttachmentIds,
                context = context
            ),
            onPrimaryAction = {
                handleAttachmentAction(
                    context = context,
                    viewModel = viewModel,
                    messageId = target.messageId,
                    attachment = target.attachment
                )
            },
            onDismiss = { previewAttachment = null }
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
                    pendingAttachments = uiState.pendingAttachments,
                    onTextChange = { viewModel.updateInput(it) },
                    onSend = { viewModel.sendMessage() },
                    onStop = { viewModel.stopTask() },
                    onAttachFile = { filePickerLauncher.launch(arrayOf("*/*")) },
                    onRemovePendingAttachment = { attachmentId ->
                        viewModel.removePendingAttachment(attachmentId)
                    },
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
                                    MessageBubble(
                                        message = message,
                                        downloadingAttachmentIds = uiState.downloadingAttachmentIds,
                                        onAttachmentAction = { attachment ->
                                            handleAttachmentAction(
                                                context = context,
                                                viewModel = viewModel,
                                                messageId = message.id,
                                                attachment = attachment
                                            )
                                        },
                                        onImageClick = { attachment ->
                                            previewAttachment = AttachmentPreviewTarget(
                                                messageId = message.id,
                                                attachment = attachment
                                            )
                                        }
                                    )
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
private fun MessageBubble(
    message: Message,
    downloadingAttachmentIds: Set<String>,
    onAttachmentAction: (MessageAttachment) -> Unit,
    onImageClick: (MessageAttachment) -> Unit
) {
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
            Column(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (message.attachments.isNotEmpty()) {
                    AttachmentGallery(
                        attachments = message.attachments,
                        downloadingAttachmentIds = downloadingAttachmentIds,
                        textColor = textColor,
                        borderColor = borderColor,
                        onAttachmentAction = onAttachmentAction,
                        onImageClick = onImageClick
                    )
                }

                if (isThinking) {
                    Text(
                        text = stringResource(R.string.chat_thinking),
                        color = textColor.copy(alpha = 0.8f),
                        style = MaterialTheme.typography.labelSmall
                    )
                }

                if (message.content.isNotBlank()) {
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
    pendingAttachments: List<MessageAttachment>,
    onTextChange: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onAttachFile: () -> Unit,
    onRemovePendingAttachment: (String) -> Unit,
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
        Column(
            modifier = Modifier
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .navigationBarsPadding()
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (pendingAttachments.isNotEmpty()) {
                PendingAttachmentTray(
                    attachments = pendingAttachments,
                    onRemove = onRemovePendingAttachment
                )
            }

            Row(
                verticalAlignment = Alignment.CenterVertically
            ) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
                ) {
                    IconButton(
                        onClick = onAttachFile,
                        enabled = enabled,
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
                    enabled = enabled,
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
                }
                Spacer(modifier = Modifier.width(if (isRunning) 8.dp else 0.dp))
                FilledIconButton(
                    onClick = onSend,
                    enabled = enabled && (text.isNotBlank() || pendingAttachments.isNotEmpty()),
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

@Composable
private fun PendingAttachmentTray(
    attachments: List<MessageAttachment>,
    onRemove: (String) -> Unit
) {
    LazyRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        items(attachments, key = { it.id }) { attachment ->
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.54f),
                shape = RoundedCornerShape(18.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AttachmentThumbnail(
                        attachment = attachment,
                        size = 42.dp,
                        onClick = null
                    )
                    Column(
                        modifier = Modifier.widthIn(max = 168.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        Text(
                            text = attachment.name,
                            style = MaterialTheme.typography.labelMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = formatFileSize(attachment.size),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    TextButton(onClick = { onRemove(attachment.id) }) {
                        Text("×")
                    }
                }
            }
        }
    }
}

@Composable
private fun AttachmentGallery(
    attachments: List<MessageAttachment>,
    downloadingAttachmentIds: Set<String>,
    textColor: Color,
    borderColor: Color,
    onAttachmentAction: (MessageAttachment) -> Unit,
    onImageClick: (MessageAttachment) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        attachments.forEach { attachment ->
            if (attachment.isImage) {
                AttachmentImageCard(
                    attachment = attachment,
                    borderColor = borderColor,
                    isDownloading = attachment.id in downloadingAttachmentIds,
                    onPrimaryAction = { onAttachmentAction(attachment) },
                    onClick = { onImageClick(attachment) }
                )
            } else {
                AttachmentFileCard(
                    attachment = attachment,
                    textColor = textColor,
                    borderColor = borderColor,
                    isDownloading = attachment.id in downloadingAttachmentIds,
                    onPrimaryAction = { onAttachmentAction(attachment) }
                )
            }
        }
    }
}

@Composable
private fun AttachmentImageCard(
    attachment: MessageAttachment,
    borderColor: Color,
    isDownloading: Boolean,
    onPrimaryAction: () -> Unit,
    onClick: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.28f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, borderColor.copy(alpha = 0.6f)),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Column(
            modifier = Modifier.padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            AttachmentThumbnail(
                attachment = attachment,
                size = null,
                onClick = onClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 88.dp, max = 220.dp)
            )
            Text(
                text = attachment.name,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = formatFileSize(attachment.size),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End
            ) {
                TextButton(onClick = onPrimaryAction) {
                    Text(
                        attachmentActionLabel(
                            attachment = attachment,
                            isDownloading = isDownloading
                        )
                    )
                }
            }
        }
    }
}

@Composable
private fun AttachmentFileCard(
    attachment: MessageAttachment,
    textColor: Color,
    borderColor: Color,
    isDownloading: Boolean,
    onPrimaryAction: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.2f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, borderColor.copy(alpha = 0.6f)),
        modifier = Modifier.clickable(onClick = onPrimaryAction)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.InsertDriveFile,
                contentDescription = stringResource(R.string.chat_file),
                tint = textColor,
                modifier = Modifier.size(20.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = attachment.name,
                    color = textColor,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = formatFileSize(attachment.size),
                    color = textColor.copy(alpha = 0.72f),
                    style = MaterialTheme.typography.labelSmall
                )
            }
            TextButton(onClick = onPrimaryAction) {
                Text(attachmentActionLabel(attachment = attachment, isDownloading = isDownloading))
            }
        }
    }
}

@Composable
private fun AttachmentThumbnail(
    attachment: MessageAttachment,
    size: androidx.compose.ui.unit.Dp?,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val bitmap by rememberAttachmentBitmap(context, attachment)
    val clickableModifier = if (onClick != null) modifier.clickable(onClick = onClick) else modifier
    val finalModifier = if (size != null) clickableModifier.size(size) else clickableModifier

    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.38f),
        shape = RoundedCornerShape(12.dp),
        modifier = finalModifier
    ) {
        if (attachment.isImage && bitmap != null) {
            Image(
                bitmap = bitmap!!,
                contentDescription = attachment.name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = if (attachment.isImage) Icons.Default.AutoAwesome else Icons.AutoMirrored.Filled.InsertDriveFile,
                    contentDescription = attachment.name,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun AttachmentPreviewDialog(
    attachment: MessageAttachment,
    actionLabel: String,
    onPrimaryAction: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val bitmap by rememberAttachmentBitmap(context, attachment)

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = RoundedCornerShape(22.dp),
            tonalElevation = 6.dp,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier.padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = attachment.name,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.38f),
                    shape = RoundedCornerShape(18.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 240.dp, max = 520.dp)
                ) {
                    if (bitmap != null) {
                        Image(
                            bitmap = bitmap!!,
                            contentDescription = attachment.name,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = attachment.name,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
                Row(
                    modifier = Modifier.align(Alignment.End),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TextButton(onClick = onPrimaryAction) {
                        Text(actionLabel)
                    }
                    TextButton(onClick = onDismiss) {
                        Text(stringResource(R.string.dismiss))
                    }
                }
            }
        }
    }
}

@Composable
private fun rememberAttachmentBitmap(
    context: Context,
    attachment: MessageAttachment
) = produceState<ImageBitmap?>(initialValue = null, attachment.id, attachment.localUri, attachment.filePath, attachment.previewDataUrl) {
    value = withContext(Dispatchers.IO) {
        loadAttachmentBitmap(context, attachment)
    }
}

private fun loadAttachmentBitmap(context: Context, attachment: MessageAttachment): ImageBitmap? {
    if (!attachment.previewDataUrl.isNullOrBlank()) {
        val dataUrl = attachment.previewDataUrl
        val base64 = dataUrl.substringAfter("base64,", missingDelimiterValue = "")
        if (base64.isNotBlank()) {
            val bytes = runCatching { android.util.Base64.decode(base64, android.util.Base64.DEFAULT) }.getOrNull()
            val bitmap = bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            if (bitmap != null) {
                return bitmap.asImageBitmap()
            }
        }
    }

    if (!attachment.localUri.isNullOrBlank()) {
        val uri = Uri.parse(attachment.localUri)
        context.contentResolver.openInputStream(uri)?.use { input ->
            val bitmap = BitmapFactory.decodeStream(input)
            if (bitmap != null) {
                return bitmap.asImageBitmap()
            }
        }
    }

    if (!attachment.filePath.isNullOrBlank()) {
        val bitmap = BitmapFactory.decodeFile(attachment.filePath)
        if (bitmap != null) {
            return bitmap.asImageBitmap()
        }
    }

    return null
}

private fun formatFileSize(bytes: Long): String {
    if (bytes <= 0L) {
        return "0 B"
    }

    val units = listOf("B", "KB", "MB", "GB")
    var value = bytes.toDouble()
    var index = 0
    while (value >= 1024 && index < units.lastIndex) {
        value /= 1024
        index += 1
    }
    val digits = if (value >= 10 || index == 0) 0 else 1
    return "%.${digits}f %s".format(value, units[index])
}

private fun handleAttachmentAction(
    context: Context,
    viewModel: ChatViewModel,
    messageId: String,
    attachment: MessageAttachment
) {
    if (isAttachmentDownloaded(context, attachment)) {
        openDownloadedAttachment(context, attachment)
    } else {
        viewModel.downloadAttachment(messageId, attachment)
    }
}

private fun openDownloadedAttachment(context: Context, attachment: MessageAttachment) {
    val uri = resolveAttachmentOpenUri(context, attachment) ?: return
    val mimeType = attachment.mimeType.ifBlank {
        if (attachment.isImage) "image/*" else "*/*"
    }
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching {
        context.startActivity(intent)
    }
}

private fun resolveAttachmentOpenUri(context: Context, attachment: MessageAttachment): Uri? {
    val localUri = attachment.localUri?.trim().orEmpty()
    if (localUri.isNotEmpty()) {
        val parsed = runCatching { Uri.parse(localUri) }.getOrNull()
        if (parsed != null) {
            when (parsed.scheme?.lowercase()) {
                "content" -> return parsed
                "file" -> {
                    val filePath = parsed.path
                    if (!filePath.isNullOrBlank()) {
                        val file = File(filePath)
                        if (file.exists() && file.isFile) {
                            return FileProvider.getUriForFile(
                                context,
                                "${context.packageName}.fileprovider",
                                file
                            )
                        }
                    }
                }
            }
        }
    }

    val localFile = attachment.filePath
        ?.takeIf { it.isNotBlank() }
        ?.let(::File)
        ?.takeIf { it.exists() && it.isFile }
        ?: return null
    return FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        localFile
    )
}

private fun isAttachmentDownloaded(context: Context, attachment: MessageAttachment): Boolean {
    val localUri = attachment.localUri?.trim().orEmpty()
    if (localUri.isNotEmpty()) {
        val parsed = runCatching { Uri.parse(localUri) }.getOrNull()
        when (parsed?.scheme?.lowercase()) {
            "content" -> {
                val canRead = runCatching {
                    context.contentResolver.openInputStream(parsed)?.use { true } ?: false
                }.getOrDefault(false)
                if (canRead) {
                    return true
                }
            }
            "file" -> {
                val filePath = parsed.path
                if (!filePath.isNullOrBlank()) {
                    val file = File(filePath)
                    if (file.exists() && file.isFile) {
                        return true
                    }
                }
            }
        }
    }

    return attachment.filePath
        ?.takeIf { it.isNotBlank() }
        ?.let(::File)
        ?.let { it.exists() && it.isFile }
        ?: false
}

@Composable
private fun attachmentActionLabel(
    attachment: MessageAttachment,
    isDownloading: Boolean,
    context: Context = LocalContext.current
): String =
    when {
        isDownloading -> stringResource(R.string.chat_downloading_attachment)
        isAttachmentDownloaded(context, attachment) -> stringResource(R.string.chat_open_attachment)
        else -> stringResource(R.string.chat_download_attachment)
    }
