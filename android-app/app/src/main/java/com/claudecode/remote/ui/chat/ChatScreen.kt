package com.claudecode.remote.ui.chat

import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.Toast
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
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import com.claudecode.remote.R
import com.claudecode.remote.UiPresenceTracker
import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.model.MessageAttachment
import com.claudecode.remote.data.model.MessageRole
import com.claudecode.remote.data.model.MessageType
import com.claudecode.remote.domain.TransferCenterItem
import com.claudecode.remote.ui.common.ClientCapabilities
import com.claudecode.remote.ui.common.ProviderUi
import com.claudecode.remote.ui.common.animateScrollToItemBottom
import com.claudecode.remote.ui.common.rememberEventCoroutineScope
import com.claudecode.remote.ui.common.scrollToItemBottom
import com.claudecode.remote.ui.transfer.ScopedTransferSheet
import com.claudecode.remote.ui.transfer.openTransferFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private data class AttachmentPreviewTarget(
    val messageId: String,
    val attachment: MessageAttachment
)

private enum class ChatPane {
    CONVERSATION,
    ACTIVITY,
    QUEUE
}

@Composable
fun ChatScreen(
    projectId: String,
    projectName: String,
    agentId: String,
    viewModel: ChatViewModel,
    onListProjectTransfers: suspend (projectId: String) -> Result<List<TransferCenterItem>>,
    onDownloadTransfer: suspend (transferId: String) -> Result<TransferCenterItem>,
    onMarkTransferOpened: suspend (transferId: String) -> Result<Unit>,
    uiPresenceTracker: UiPresenceTracker,
    onNavigateBack: () -> Unit
) {
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    val lifecycleOwner = context as? LifecycleOwner
    val uiState by viewModel.uiState.collectAsState()
    val conversationListState = remember(projectId) { LazyListState() }
    val activityListState = remember(projectId) { LazyListState() }
    val queueListState = remember(projectId) { LazyListState() }
    val eventScope = rememberEventCoroutineScope()
    var selectedPane by rememberSaveable(projectId) { mutableStateOf(ChatPane.CONVERSATION) }
    var showModelDialog by remember { mutableStateOf(false) }
    var showConversationDialog by remember { mutableStateOf(false) }
    var modelInput by remember { mutableStateOf("") }
    var hasInitialConversationScrollPosition by remember(projectId) { mutableStateOf(false) }
    var pendingConversationBottomScroll by remember(projectId) { mutableStateOf(true) }
    var previousLastMessageId by remember(projectId) { mutableStateOf<String?>(null) }
    var previousMessageCount by remember(projectId) { mutableStateOf(0) }
    var hasInitialActivityScrollPosition by remember(projectId) { mutableStateOf(false) }
    var pendingActivityBottomScroll by remember(projectId) { mutableStateOf(true) }
    var previousLastActivityId by remember(projectId) { mutableStateOf<String?>(null) }
    var previousActivityCount by remember(projectId) { mutableStateOf(0) }
    var resumeScrollRequestToken by remember(projectId) { mutableStateOf(0) }
    var handledConversationResumeScrollToken by remember(projectId) { mutableStateOf(0) }
    var handledActivityResumeScrollToken by remember(projectId) { mutableStateOf(0) }
    var previewAttachment by remember(projectId) { mutableStateOf<AttachmentPreviewTarget?>(null) }
    var showTransferSheet by remember(projectId) { mutableStateOf(false) }
    var transferRefreshToken by remember(projectId) { mutableStateOf(0) }
    var scopedTransfers by remember(projectId) { mutableStateOf(emptyList<TransferCenterItem>()) }
    var isRefreshingTransfers by remember(projectId) { mutableStateOf(false) }
    var busyTransferId by remember(projectId) { mutableStateOf<String?>(null) }

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
            transferRefreshToken += 1
        }
    }

    LaunchedEffect(projectId, uiState.activeConversationId) {
        hasInitialConversationScrollPosition = false
        pendingConversationBottomScroll = true
        previousLastMessageId = null
        previousMessageCount = 0
        hasInitialActivityScrollPosition = false
        pendingActivityBottomScroll = true
        previousLastActivityId = null
        previousActivityCount = 0
        handledConversationResumeScrollToken = 0
        handledActivityResumeScrollToken = 0
    }

    LaunchedEffect(projectId, selectedPane) {
        when (selectedPane) {
            ChatPane.CONVERSATION -> pendingConversationBottomScroll = true
            ChatPane.ACTIVITY -> pendingActivityBottomScroll = true
            ChatPane.QUEUE -> Unit
        }
    }

    LaunchedEffect(projectId, transferRefreshToken) {
        if (projectId.isBlank()) {
            scopedTransfers = emptyList()
            isRefreshingTransfers = false
            return@LaunchedEffect
        }
        isRefreshingTransfers = true
        onListProjectTransfers(projectId).fold(
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

    LaunchedEffect(
        projectId,
        selectedPane,
        uiState.hasMoreHistory,
        uiState.hasMoreActivityHistory,
        uiState.isLoadingOlder
    ) {
        snapshotFlow {
            when (selectedPane) {
                ChatPane.ACTIVITY -> activityListState.firstVisibleItemIndex to activityListState.firstVisibleItemScrollOffset
                ChatPane.CONVERSATION -> conversationListState.firstVisibleItemIndex to conversationListState.firstVisibleItemScrollOffset
                ChatPane.QUEUE -> null
            }
        }
            .distinctUntilChanged()
            .collect { state ->
                val (index, offset) = state ?: return@collect
                val canAutoLoadOlder = when (selectedPane) {
                    ChatPane.CONVERSATION -> hasInitialConversationScrollPosition && !pendingConversationBottomScroll
                    ChatPane.ACTIVITY -> hasInitialActivityScrollPosition && !pendingActivityBottomScroll
                    ChatPane.QUEUE -> false
                }
                if (!canAutoLoadOlder) {
                    return@collect
                }
                if (index == 0 && offset <= 24) {
                    when (selectedPane) {
                        ChatPane.CONVERSATION -> {
                            if (uiState.hasMoreHistory && !uiState.isLoadingOlder) {
                                viewModel.loadOlderMessages()
                            }
                        }
                        ChatPane.ACTIVITY -> {
                            if (uiState.hasMoreActivityHistory) {
                                viewModel.loadOlderActivityMessages()
                            }
                        }
                        ChatPane.QUEUE -> Unit
                    }
                }
            }
    }

    DisposableEffect(projectId) {
        uiPresenceTracker.setActiveProject(projectId)
        onDispose {
            uiPresenceTracker.setActiveProject(null)
        }
    }

    DisposableEffect(lifecycleOwner, projectId) {
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
    LaunchedEffect(
        lastMessage?.id,
        lastMessage?.content,
        lastMessage?.isStreaming,
        uiState.messages.size,
        selectedPane,
        resumeScrollRequestToken
    ) {
        if (uiState.messages.isEmpty()) {
            hasInitialConversationScrollPosition = false
            pendingConversationBottomScroll = true
            previousLastMessageId = null
            previousMessageCount = 0
            return@LaunchedEffect
        }

        val lastIndex = uiState.messages.lastIndex
        val lastVisibleIndex = conversationListState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: lastIndex
        val isNearBottom = lastVisibleIndex >= lastIndex - 1
        val hasAppendedMessage =
            uiState.messages.size > previousMessageCount || lastMessage?.id != previousLastMessageId
        val shouldForceLatestOnResume = resumeScrollRequestToken != handledConversationResumeScrollToken

        when {
            pendingConversationBottomScroll && selectedPane == ChatPane.CONVERSATION -> {
                conversationListState.scrollToItemBottom(lastIndex)
                hasInitialConversationScrollPosition = true
                pendingConversationBottomScroll = false
                handledConversationResumeScrollToken = resumeScrollRequestToken
            }
            !hasInitialConversationScrollPosition && selectedPane == ChatPane.CONVERSATION -> {
                conversationListState.scrollToItemBottom(lastIndex)
                hasInitialConversationScrollPosition = true
                pendingConversationBottomScroll = false
                handledConversationResumeScrollToken = resumeScrollRequestToken
            }
            shouldForceLatestOnResume && selectedPane == ChatPane.CONVERSATION -> {
                conversationListState.scrollToItemBottom(lastIndex)
                hasInitialConversationScrollPosition = true
                pendingConversationBottomScroll = false
                handledConversationResumeScrollToken = resumeScrollRequestToken
            }
            !isNearBottom -> Unit
            hasAppendedMessage && selectedPane == ChatPane.CONVERSATION ->
                conversationListState.animateScrollToItemBottom(lastIndex)
            lastMessage?.isStreaming == true && selectedPane == ChatPane.CONVERSATION -> {
                conversationListState.scrollToItemBottom(lastIndex)
            }
        }

        previousLastMessageId = lastMessage?.id
        previousMessageCount = uiState.messages.size
    }

    val lastActivityMessage = uiState.activityMessages.lastOrNull()
    LaunchedEffect(
        lastActivityMessage?.id,
        lastActivityMessage?.content,
        lastActivityMessage?.isStreaming,
        uiState.activityMessages.size,
        selectedPane,
        resumeScrollRequestToken
    ) {
        if (uiState.activityMessages.isEmpty()) {
            hasInitialActivityScrollPosition = false
            pendingActivityBottomScroll = true
            previousLastActivityId = null
            previousActivityCount = 0
            return@LaunchedEffect
        }

        val lastIndex = uiState.activityMessages.lastIndex
        val lastVisibleIndex = activityListState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: lastIndex
        val isNearBottom = lastVisibleIndex >= lastIndex - 1
        val hasAppendedMessage =
            uiState.activityMessages.size > previousActivityCount || lastActivityMessage?.id != previousLastActivityId
        val shouldForceLatestOnResume = resumeScrollRequestToken != handledActivityResumeScrollToken

        when {
            pendingActivityBottomScroll && selectedPane == ChatPane.ACTIVITY -> {
                activityListState.scrollToItemBottom(lastIndex)
                hasInitialActivityScrollPosition = true
                pendingActivityBottomScroll = false
                handledActivityResumeScrollToken = resumeScrollRequestToken
            }
            !hasInitialActivityScrollPosition && selectedPane == ChatPane.ACTIVITY -> {
                activityListState.scrollToItemBottom(lastIndex)
                hasInitialActivityScrollPosition = true
                pendingActivityBottomScroll = false
                handledActivityResumeScrollToken = resumeScrollRequestToken
            }
            shouldForceLatestOnResume && selectedPane == ChatPane.ACTIVITY -> {
                activityListState.scrollToItemBottom(lastIndex)
                hasInitialActivityScrollPosition = true
                pendingActivityBottomScroll = false
                handledActivityResumeScrollToken = resumeScrollRequestToken
            }
            !isNearBottom -> Unit
            hasAppendedMessage && selectedPane == ChatPane.ACTIVITY ->
                activityListState.animateScrollToItemBottom(lastIndex)
            lastActivityMessage?.isStreaming == true && selectedPane == ChatPane.ACTIVITY -> {
                activityListState.scrollToItemBottom(lastIndex)
            }
        }

        previousLastActivityId = lastActivityMessage?.id
        previousActivityCount = uiState.activityMessages.size
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

    if (showConversationDialog) {
        AlertDialog(
            onDismissRequest = { showConversationDialog = false },
            title = { Text(stringResource(R.string.chat_conversations_title)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    TextButton(
                        onClick = {
                            showConversationDialog = false
                            viewModel.createConversation()
                        },
                        enabled = !uiState.isRunning && uiState.queuedCount == 0 && !uiState.isSwitchingConversation
                    ) {
                        Text(stringResource(R.string.chat_new_conversation))
                    }
                    uiState.conversations.forEach { conversation ->
                        Surface(
                            color = if (conversation.isActive) {
                                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.72f)
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.32f)
                            },
                            shape = RoundedCornerShape(16.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(
                                    enabled = !conversation.isActive && !uiState.isRunning && uiState.queuedCount == 0 && !uiState.isSwitchingConversation
                                ) {
                                    showConversationDialog = false
                                    viewModel.switchConversation(conversation.id)
                                }
                        ) {
                            Column(
                                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Text(
                                    text = conversation.title,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = if (conversation.isActive) FontWeight.SemiBold else FontWeight.Normal,
                                    color = if (conversation.isActive) {
                                        MaterialTheme.colorScheme.onPrimaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onSurface
                                    }
                                )
                                Text(
                                    text = formatTimestamp(conversation.updatedAt),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showConversationDialog = false }) {
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

    if (showTransferSheet) {
        ScopedTransferSheet(
            title = stringResource(R.string.chat_transfers_title_project),
            subtitle = stringResource(R.string.chat_transfers_subtitle_project),
            emptyMessage = stringResource(R.string.chat_transfers_empty_project),
            transfers = scopedTransfers,
            isRefreshing = isRefreshingTransfers,
            busyTransferId = busyTransferId,
            onRefresh = { transferRefreshToken += 1 },
            onDownloadTransfer = { item ->
                eventScope.launch {
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
                    eventScope.launch {
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
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
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
                    conversationTitle = uiState.activeConversationTitle ?: stringResource(R.string.chat_switch_conversation),
                    provider = providerLabel(uiState.cliProvider),
                    model = modelLabel(uiState.cliModel),
                    isConnected = uiState.isConnected,
                    runtimeText = runtimeLabel(uiState),
                    runtimeTone = runtimeColor(uiState),
                    transferCount = scopedTransfers.size,
                    onNavigateBack = onNavigateBack,
                    onRefresh = {
                        viewModel.refresh()
                        transferRefreshToken += 1
                    },
                    onOpenTransfers = { showTransferSheet = true },
                    onOpenConversations = { showConversationDialog = true },
                    onChangeModel = {
                        modelInput = uiState.cliModel
                        showModelDialog = true
                    },
                    conversationEnabled = uiState.isConnected,
                    refreshEnabled = !uiState.isSwitchingConversation,
                    modelEnabled = uiState.isConnected && !uiState.isSending
                )

                Surface(
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                    shape = RoundedCornerShape(20.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
                    shadowElevation = 2.dp,
                    modifier = Modifier.fillMaxSize()
                ) {
                    Column(modifier = Modifier.fillMaxSize()) {
                        ChatPaneTabs(
                            selectedPane = selectedPane,
                            activityCount = uiState.activityMessages.size,
                            queueCount = maxOf(uiState.queueItems.size, uiState.queuedCount),
                            onSelectPane = { selectedPane = it }
                        )

                        if (shouldShowRuntimeBanner(uiState)) {
                            RuntimeNoticeBanner(uiState = uiState)
                        }

                        if (selectedPane == ChatPane.CONVERSATION && uiState.messages.isEmpty()) {
                            ChatEmptyState(
                                title = stringResource(R.string.no_messages),
                                detail = stringResource(R.string.chat_pane_conversation_hint)
                            )
                        } else if (selectedPane == ChatPane.ACTIVITY && uiState.activityMessages.isEmpty()) {
                            ChatEmptyState(
                                title = stringResource(R.string.chat_no_activity),
                                detail = stringResource(R.string.chat_pane_activity_hint)
                            )
                        } else if (selectedPane == ChatPane.QUEUE && uiState.queueItems.isEmpty() && uiState.queuedCount <= 0) {
                            ChatEmptyState(
                                title = stringResource(R.string.chat_no_queue),
                                detail = stringResource(R.string.chat_pane_queue_hint)
                            )
                        } else {
                            LazyColumn(
                                state = when (selectedPane) {
                                    ChatPane.ACTIVITY -> activityListState
                                    ChatPane.CONVERSATION -> conversationListState
                                    ChatPane.QUEUE -> queueListState
                                },
                                modifier = Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                if (selectedPane == ChatPane.CONVERSATION && uiState.isLoadingOlder) {
                                    item(key = "loading-older") {
                                        ChatHistoryBanner(
                                            text = stringResource(R.string.chat_loading_older),
                                            loading = true
                                        )
                                    }
                                }
                                if (selectedPane == ChatPane.QUEUE) {
                                    items(uiState.queueItems, key = { item ->
                                        item.runId.ifBlank { "${item.source}-${item.queuedAt}-${item.prompt}" }
                                    }) { item ->
                                        QueueItemCard(item = item)
                                    }
                                } else {
                                    val activeMessages = if (selectedPane == ChatPane.ACTIVITY) uiState.activityMessages else uiState.messages
                                    items(activeMessages, key = { it.id }) { message ->
                                        MessageBubble(
                                            message = message,
                                            downloadingAttachmentIds = uiState.downloadingAttachmentIds,
                                            onCopyMessage = { content ->
                                                clipboardManager.setText(AnnotatedString(content))
                                                Toast.makeText(
                                                    context,
                                                    context.getString(R.string.chat_message_copied),
                                                    Toast.LENGTH_SHORT
                                                ).show()
                                            },
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
}

@Composable
private fun QueueItemCard(item: QueueItem) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.28f),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f))
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                RuntimePill(
                    text = queueSourceLabel(item.source),
                    color = if (item.source == "remote") {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.secondary
                    }
                )
                if (item.queuedAt > 0L) {
                    Text(
                        text = formatTimestamp(item.queuedAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            Text(
                text = item.prompt.ifBlank { stringResource(R.string.chat_pane_queue_hint) },
                style = MaterialTheme.typography.bodyMedium,
                color = if (item.isPlaceholder) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                }
            )
        }
    }
}

@Composable
private fun queueSourceLabel(source: String): String =
    when (source.trim().lowercase()) {
        "remote" -> stringResource(R.string.chat_queue_source_remote)
        "desktop" -> stringResource(R.string.chat_queue_source_desktop)
        else -> source.ifBlank { stringResource(R.string.chat_queue_source_unknown) }
    }

private fun providerLabel(provider: String): String = ProviderUi.label(provider)

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
private fun ChatPaneTabs(
    selectedPane: ChatPane,
    activityCount: Int,
    queueCount: Int,
    onSelectPane: (ChatPane) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        ChatPaneTab(
            label = stringResource(R.string.chat_view_conversation),
            selected = selectedPane == ChatPane.CONVERSATION,
            onClick = { onSelectPane(ChatPane.CONVERSATION) },
            modifier = Modifier.weight(1f)
        )
        ChatPaneTab(
            label = stringResource(R.string.chat_view_activity, activityCount),
            selected = selectedPane == ChatPane.ACTIVITY,
            onClick = { onSelectPane(ChatPane.ACTIVITY) },
            modifier = Modifier.weight(1f)
        )
        ChatPaneTab(
            label = stringResource(R.string.chat_view_queue, queueCount),
            selected = selectedPane == ChatPane.QUEUE,
            onClick = { onSelectPane(ChatPane.QUEUE) },
            modifier = Modifier.weight(1f)
        )
    }
}

@Composable
private fun ChatPaneTab(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        color = if (selected) {
            MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.34f)
        },
        shape = RoundedCornerShape(999.dp),
        border = BorderStroke(
            1.dp,
            if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.24f)
            else MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)
        ),
        modifier = modifier.clickable(onClick = onClick)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 7.dp)
        )
    }
}

@Composable
private fun ChatPaneSummaryStrip(
    selectedPane: ChatPane,
    conversationCount: Int,
    activityCount: Int,
    queueCount: Int,
    hasMoreHistory: Boolean
) {
    val (title, count, detail) = when (selectedPane) {
        ChatPane.CONVERSATION -> Triple(
            stringResource(R.string.chat_view_conversation),
            conversationCount,
            if (hasMoreHistory) {
                stringResource(R.string.chat_history_hint)
            } else {
                stringResource(R.string.chat_pane_conversation_hint)
            }
        )
        ChatPane.ACTIVITY -> Triple(
            stringResource(R.string.chat_view_activity, activityCount),
            activityCount,
            stringResource(R.string.chat_pane_activity_hint)
        )
        ChatPane.QUEUE -> Triple(
            stringResource(R.string.chat_view_queue, queueCount),
            queueCount,
            stringResource(R.string.chat_pane_queue_hint)
        )
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = detail,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        RuntimePill(
            text = stringResource(R.string.chat_pane_item_count, count),
            color = MaterialTheme.colorScheme.primary
        )
    }
}

@Composable
private fun ChatHistoryBanner(
    text: String,
    loading: Boolean
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
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 2.dp
                )
            }
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun ChatEmptyState(
    title: String,
    detail: String
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 18.dp, vertical = 14.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
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
private fun ChatHeader(
    title: String,
    conversationTitle: String,
    provider: String,
    model: String,
    isConnected: Boolean,
    runtimeText: String,
    runtimeTone: Color,
    transferCount: Int,
    onNavigateBack: () -> Unit,
    onRefresh: () -> Unit,
    onOpenTransfers: () -> Unit,
    onOpenConversations: () -> Unit,
    onChangeModel: () -> Unit,
    conversationEnabled: Boolean,
    refreshEnabled: Boolean,
    modelEnabled: Boolean
) {
    Surface(
        color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
        shape = RoundedCornerShape(20.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.12f)),
        shadowElevation = 3.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 9.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Top
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
                    if (transferCount > 0) {
                        RuntimePill(
                            text = stringResource(R.string.chat_transfers_chip, transferCount),
                            color = MaterialTheme.colorScheme.primary
                        )
                    }
                    Text(
                        text = "$conversationTitle · $provider / $model",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            ChatHeaderButton(
                icon = Icons.Default.Refresh,
                contentDescription = stringResource(R.string.action_refresh),
                enabled = refreshEnabled,
                tint = MaterialTheme.colorScheme.onSurface,
                onClick = onRefresh
            )
            ChatHeaderButton(
                icon = Icons.Default.AttachFile,
                contentDescription = stringResource(R.string.settings_transfers_title),
                enabled = true,
                tint = MaterialTheme.colorScheme.primary,
                onClick = onOpenTransfers
            )
            ChatHeaderButton(
                icon = Icons.Default.History,
                contentDescription = stringResource(R.string.chat_conversations_title),
                enabled = conversationEnabled,
                tint = MaterialTheme.colorScheme.onSurface,
                onClick = onOpenConversations
            )
            ChatHeaderButton(
                icon = Icons.Default.AutoAwesome,
                contentDescription = stringResource(R.string.action_model),
                enabled = modelEnabled,
                tint = MaterialTheme.colorScheme.primary,
                onClick = onChangeModel
            )
        }
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
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.14f)),
        shadowElevation = 3.dp
    ) {
        IconButton(
            onClick = onClick,
            enabled = enabled,
            modifier = Modifier.size(38.dp),
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
            .padding(start = 10.dp, end = 10.dp, top = 6.dp)
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
@OptIn(ExperimentalFoundationApi::class)
private fun MessageBubble(
    message: Message,
    downloadingAttachmentIds: Set<String>,
    onCopyMessage: (String) -> Unit,
    onAttachmentAction: (MessageAttachment) -> Unit,
    onImageClick: (MessageAttachment) -> Unit
) {
    val isUser = message.role == MessageRole.USER
    val isThinking = message.type == MessageType.THINKING
    val isActivity = message.type == MessageType.ACTIVITY
    val isCli = message.type == MessageType.CLI
    val bubbleColor = when {
        isUser -> MaterialTheme.colorScheme.primary.copy(alpha = 0.92f)
        isThinking -> MaterialTheme.colorScheme.secondaryContainer.copy(alpha = 0.94f)
        isActivity -> MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.72f)
        isCli -> MaterialTheme.colorScheme.surface.copy(alpha = 0.96f)
        else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.44f)
    }
    val textColor = when {
        isUser -> MaterialTheme.colorScheme.onPrimary
        isThinking -> MaterialTheme.colorScheme.onSecondaryContainer
        isActivity -> MaterialTheme.colorScheme.onTertiaryContainer
        else -> MaterialTheme.colorScheme.onSurface
    }
    val borderColor = when {
        isUser -> MaterialTheme.colorScheme.primary.copy(alpha = 0.2f)
        isThinking -> MaterialTheme.colorScheme.secondary.copy(alpha = 0.16f)
        isActivity -> MaterialTheme.colorScheme.tertiary.copy(alpha = 0.16f)
        isCli -> MaterialTheme.colorScheme.outline.copy(alpha = 0.22f)
        else -> MaterialTheme.colorScheme.outline.copy(alpha = 0.14f)
    }
    val alignment = if (isUser) Alignment.End else Alignment.Start
    val activityDisplay = if (isActivity) parseActivityDisplay(message.content) else null
    val canCopyMessage = message.content.isNotBlank()

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
            modifier = Modifier
                .widthIn(max = 332.dp)
                .combinedClickable(
                    enabled = canCopyMessage,
                    onClick = {},
                    onLongClick = { onCopyMessage(message.content) }
                )
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
                } else if (isActivity) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = stringResource(R.string.chat_activity),
                                color = textColor.copy(alpha = 0.82f),
                                style = MaterialTheme.typography.labelSmall
                            )
                            activityDisplay?.meta?.takeIf { it.isNotBlank() }?.let { meta ->
                                Text(
                                    text = meta,
                                    color = textColor.copy(alpha = 0.68f),
                                    style = MaterialTheme.typography.labelSmall
                                )
                            }
                        }
                        Text(
                            text = formatTimestamp(message.timestamp),
                            color = textColor.copy(alpha = 0.64f),
                            style = MaterialTheme.typography.labelSmall
                        )
                    }
                } else if (isCli) {
                    Text(
                        text = stringResource(R.string.chat_cli),
                        color = textColor.copy(alpha = 0.82f),
                        style = MaterialTheme.typography.labelSmall
                    )
                }

                if (isActivity && activityDisplay != null) {
                    activityDisplay.title?.takeIf { it.isNotBlank() }?.let { title ->
                        Text(
                            text = title,
                            color = textColor,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    activityDisplay.detail?.takeIf { it.isNotBlank() }?.let { detail ->
                        Text(
                            text = detail,
                            color = textColor,
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                } else if (message.content.isNotBlank()) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            text = message.content,
                            color = textColor,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontStyle = if (isThinking) FontStyle.Italic else FontStyle.Normal
                            ),
                            fontFamily = if (isCli) FontFamily.Monospace else FontFamily.Default,
                            fontWeight = if (isUser) FontWeight.Medium else FontWeight.Normal,
                            modifier = Modifier.weight(1f, fill = false)
                        )
                        if (message.isStreaming) {
                            Spacer(modifier = Modifier.width(4.dp))
                            BlinkingCursor(color = textColor)
                        }
                    }
                    Text(
                        text = formatTimestamp(message.timestamp),
                        color = textColor.copy(alpha = 0.64f),
                        style = MaterialTheme.typography.labelSmall
                    )
                }
            }
        }
    }
}

private data class ActivityDisplay(
    val meta: String?,
    val title: String?,
    val detail: String?
)

private fun parseActivityDisplay(rawContent: String): ActivityDisplay {
    val normalized = rawContent.replace("\r\n", "\n").trim()
    if (normalized.isEmpty()) {
        return ActivityDisplay(meta = null, title = null, detail = null)
    }

    val lines = normalized
        .split('\n')
        .map { it.trim() }
        .filter { it.isNotEmpty() }

    if (lines.isEmpty()) {
        return ActivityDisplay(meta = null, title = null, detail = null)
    }

    val firstLine = lines.first()
    val hasMetaLine = firstLine.contains("路") || firstLine.contains("·")
    val title = when {
        hasMetaLine && lines.size >= 2 -> lines[1]
        else -> firstLine
    }
    val detailLines = when {
        hasMetaLine && lines.size >= 3 -> lines.drop(2)
        hasMetaLine -> emptyList()
        lines.size >= 2 -> lines.drop(1)
        else -> emptyList()
    }

    return ActivityDisplay(
        meta = firstLine.takeIf { hasMetaLine },
        title = title.takeIf { it.isNotBlank() },
        detail = detailLines.joinToString("\n").trim().takeIf { it.isNotBlank() }
    )
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
        tonalElevation = 3.dp,
        shadowElevation = 6.dp,
        shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
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
                if (ClientCapabilities.supportsMessageAttachments) {
                  Surface(
                      shape = RoundedCornerShape(16.dp),
                      color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.36f)
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
private fun PendingAttachmentTrayLegacy(
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
                    IconButton(
                        onClick = { onRemove(attachment.id) },
                        modifier = Modifier.size(28.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = stringResource(R.string.action_remove_attachment),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
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

private fun formatTimestamp(timestamp: Long): String =
    java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.getDefault()).format(java.util.Date(timestamp))

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
