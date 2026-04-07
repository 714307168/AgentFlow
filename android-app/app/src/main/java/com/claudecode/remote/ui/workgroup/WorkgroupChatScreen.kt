package com.claudecode.remote.ui.workgroup

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
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
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import com.claudecode.remote.R
import com.claudecode.remote.data.model.WorkgroupMember
import com.claudecode.remote.data.model.WorkgroupMessage
import com.claudecode.remote.domain.TransferCenterItem
import com.claudecode.remote.ui.transfer.ScopedTransferSheet
import com.claudecode.remote.ui.transfer.openTransferFile
import kotlinx.coroutines.launch

@Composable
fun WorkgroupChatScreen(
    agentId: String,
    workgroupId: String,
    workgroupName: String,
    viewModel: WorkgroupChatViewModel,
    onListWorkgroupTransfers: suspend (workgroupId: String) -> Result<List<TransferCenterItem>>,
    onDownloadTransfer: suspend (transferId: String) -> Result<TransferCenterItem>,
    onMarkTransferOpened: suspend (transferId: String) -> Result<Unit>,
    onNavigateBack: () -> Unit
) {
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    val lifecycleOwner = context as? LifecycleOwner
    var previousLastMessageId by remember(agentId, workgroupId) { mutableStateOf<String?>(null) }
    var previousMessageCount by remember(agentId, workgroupId) { mutableStateOf(0) }
    var resumeScrollRequestToken by remember(agentId, workgroupId) { mutableStateOf(0) }
    var handledResumeScrollToken by remember(agentId, workgroupId) { mutableStateOf(0) }
    var showTransferSheet by remember(agentId, workgroupId) { mutableStateOf(false) }
    var transferRefreshToken by remember(agentId, workgroupId) { mutableStateOf(0) }
    var scopedTransfers by remember(agentId, workgroupId) { mutableStateOf(emptyList<TransferCenterItem>()) }
    var isRefreshingTransfers by remember(agentId, workgroupId) { mutableStateOf(false) }
    var busyTransferId by remember(agentId, workgroupId) { mutableStateOf<String?>(null) }

    LaunchedEffect(agentId, workgroupId, workgroupName) {
        viewModel.loadWorkgroup(agentId, workgroupId, workgroupName)
        transferRefreshToken += 1
    }

    LaunchedEffect(agentId, workgroupId, transferRefreshToken) {
        if (workgroupId.isBlank()) {
            scopedTransfers = emptyList()
            isRefreshingTransfers = false
            return@LaunchedEffect
        }
        isRefreshingTransfers = true
        onListWorkgroupTransfers(workgroupId).fold(
            onSuccess = { scopedTransfers = it },
            onFailure = {
                scopedTransfers = emptyList()
                Toast.makeText(
                    context,
                    it.message ?: context.getString(R.string.settings_transfers_load_failed),
                    Toast.LENGTH_SHORT
                ).show()
            }
        )
        isRefreshingTransfers = false
    }

    DisposableEffect(lifecycleOwner, agentId, workgroupId) {
        if (lifecycleOwner == null) {
            onDispose { }
        } else {
            val observer = LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) {
                    viewModel.onResume()
                    resumeScrollRequestToken += 1
                    transferRefreshToken += 1
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
        if (showTransferSheet) {
            ScopedTransferSheet(
                title = stringResource(R.string.chat_transfers_title_workgroup),
                subtitle = stringResource(R.string.chat_transfers_subtitle_workgroup),
                emptyMessage = stringResource(R.string.chat_transfers_empty_workgroup),
                transfers = scopedTransfers,
                isRefreshing = isRefreshingTransfers,
                busyTransferId = busyTransferId,
                onRefresh = { transferRefreshToken += 1 },
                onDownloadTransfer = { item ->
                    coroutineScope.launch {
                        busyTransferId = item.id
                        onDownloadTransfer(item.id).fold(
                            onSuccess = { updated ->
                                scopedTransfers = scopedTransfers.map { candidate ->
                                    if (candidate.id == updated.id) updated else candidate
                                }
                                Toast.makeText(
                                    context,
                                    context.getString(R.string.settings_transfers_downloaded, updated.fileName),
                                    Toast.LENGTH_SHORT
                                ).show()
                            },
                            onFailure = {
                                Toast.makeText(
                                    context,
                                    it.message ?: context.getString(R.string.settings_transfers_download_failed),
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        )
                        busyTransferId = null
                    }
                },
                onOpenTransfer = { item ->
                    val openResult = openTransferFile(context, item)
                    if (openResult.isSuccess) {
                        coroutineScope.launch {
                            onMarkTransferOpened(item.id)
                        }
                    } else {
                        Toast.makeText(
                            context,
                            openResult.exceptionOrNull()?.message ?: context.getString(R.string.settings_transfers_open_failed),
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                },
                onDismissRequest = { showTransferSheet = false }
            )
        }
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
                        transferCount = scopedTransfers.size,
                        onOpenTransfers = { showTransferSheet = true },
                        onRefresh = {
                            viewModel.refresh()
                            transferRefreshToken += 1
                        }
                    )

                    WorkgroupSummaryStrip(
                        messageCount = uiState.messages.size,
                        memberCount = uiState.members.size,
                        transferCount = scopedTransfers.size,
                        hasMoreHistory = uiState.hasMoreHistory,
                        description = uiState.description
                    )

                    if (!uiState.isConnected || uiState.isRunning) {
                        WorkgroupRuntimeBanner(uiState = uiState)
                    }

                    Surface(
                        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                        shape = RoundedCornerShape(20.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
                        modifier = Modifier.fillMaxSize()
                    ) {
                        if (uiState.isLoading && uiState.messages.isEmpty()) {
                            WorkgroupEmptyState(
                                title = stringResource(R.string.workgroups_loading_chat),
                                detail = stringResource(R.string.workgroups_loading_hint),
                                loading = true
                            )
                        } else if (uiState.messages.isEmpty()) {
                            WorkgroupEmptyState(
                                title = stringResource(R.string.workgroups_no_messages),
                                detail = stringResource(R.string.workgroups_empty_hint)
                            )
                        } else {
                            LazyColumn(
                                state = listState,
                                modifier = Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                item(key = "history-header") {
                                    if (uiState.hasMoreHistory) {
                                        WorkgroupHistoryBanner(
                                            isLoadingOlder = uiState.isLoadingOlder,
                                            onLoadOlder = viewModel::loadOlderMessages
                                        )
                                    }
                                }
                                items(uiState.messages, key = { it.id }) { message ->
                                    WorkgroupMessageBubble(
                                        message = message,
                                        onCopyMessage = { content ->
                                            clipboardManager.setText(AnnotatedString(content))
                                            Toast.makeText(
                                                context,
                                                context.getString(R.string.chat_message_copied),
                                                Toast.LENGTH_SHORT
                                            ).show()
                                        }
                                    )
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
    transferCount: Int,
    onOpenTransfers: () -> Unit,
    onRefresh: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        shape = RoundedCornerShape(22.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
        shadowElevation = 4.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
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
                IconButton(onClick = onRefresh, enabled = !uiState.isLoading) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = stringResource(R.string.action_refresh)
                    )
                }
                IconButton(onClick = onOpenTransfers) {
                    Icon(
                        imageVector = Icons.Default.AttachFile,
                        contentDescription = stringResource(R.string.settings_transfers_title)
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
                if (transferCount > 0) {
                    item("transfers") {
                        HeaderChip(
                            text = stringResource(R.string.chat_transfers_chip, transferCount),
                            containerColor = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
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
}

@Composable
private fun WorkgroupSummaryStrip(
    messageCount: Int,
    memberCount: Int,
    transferCount: Int,
    hasMoreHistory: Boolean,
    description: String?
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = stringResource(R.string.workgroups_summary_title),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = description?.takeIf { it.isNotBlank() }
                    ?: if (hasMoreHistory) {
                        stringResource(R.string.chat_history_hint)
                    } else {
                        stringResource(R.string.workgroups_summary_hint)
                    },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HeaderChip(
                text = stringResource(R.string.chat_pane_item_count, messageCount),
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer
            )
            HeaderChip(
                text = stringResource(R.string.workgroups_members_count, memberCount),
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (transferCount > 0) {
                HeaderChip(
                    text = stringResource(R.string.chat_transfers_chip, transferCount),
                    containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                    contentColor = MaterialTheme.colorScheme.onTertiaryContainer
                )
            }
        }
    }
}

@Composable
private fun WorkgroupRuntimeBanner(uiState: WorkgroupChatUiState) {
    val containerColor = if (uiState.isConnected) {
        MaterialTheme.colorScheme.tertiaryContainer
    } else {
        MaterialTheme.colorScheme.errorContainer
    }
    val contentColor = if (uiState.isConnected) {
        MaterialTheme.colorScheme.onTertiaryContainer
    } else {
        MaterialTheme.colorScheme.onErrorContainer
    }
    val summary = when {
        !uiState.isConnected -> stringResource(R.string.workgroups_runtime_offline_hint)
        uiState.isRunning -> stringResource(R.string.workgroups_runtime_running_hint)
        else -> stringResource(R.string.status_ready)
    }

    Surface(
        color = containerColor,
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, contentColor.copy(alpha = 0.12f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Groups,
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(18.dp)
            )
            Text(
                text = summary,
                style = MaterialTheme.typography.bodySmall,
                color = contentColor
            )
        }
    }
}

@Composable
private fun WorkgroupHistoryBanner(
    isLoadingOlder: Boolean,
    onLoadOlder: () -> Unit
) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.38f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = if (isLoadingOlder) {
                    stringResource(R.string.chat_loading_older_safe)
                } else {
                    stringResource(R.string.workgroups_load_older)
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (isLoadingOlder) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 2.dp
                )
            } else {
                TextButton(onClick = onLoadOlder) {
                    Text(stringResource(R.string.action_refresh))
                }
            }
        }
    }
}

@Composable
private fun WorkgroupEmptyState(
    title: String,
    detail: String,
    loading: Boolean = false
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp, vertical = 18.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp
                )
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = detail,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
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
@OptIn(ExperimentalFoundationApi::class)
private fun WorkgroupMessageBubble(
    message: WorkgroupMessage,
    onCopyMessage: (String) -> Unit
) {
    val isUser = message.senderType == "user"
    val isSystem = message.senderType == "system"
    val isError = message.senderType == "error"
    val canCopyMessage = message.content.isNotBlank()

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
            modifier = Modifier
                .fillMaxWidth(0.9f)
                .combinedClickable(
                    enabled = canCopyMessage,
                    onClick = {},
                    onLongClick = { onCopyMessage(message.content) }
                )
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
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
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
                        Surface(
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.46f),
                            shape = RoundedCornerShape(999.dp),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
                        ) {
                            TextButton(
                                onClick = { onApplyMention(suggestion) },
                                enabled = enabled
                            ) {
                                Text("${suggestion.label} ${suggestion.meta}", maxLines = 1)
                            }
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
                    shape = RoundedCornerShape(22.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surface,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.28f)
                    )
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
