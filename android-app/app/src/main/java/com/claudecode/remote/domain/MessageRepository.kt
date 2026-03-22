package com.claudecode.remote.domain

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Environment
import android.provider.OpenableColumns
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.room.withTransaction
import com.claudecode.remote.data.local.AppDatabase
import com.claudecode.remote.data.local.MessageEntity
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.FileInfo
import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.model.MessageAttachment
import com.claudecode.remote.data.model.MessageRole
import com.claudecode.remote.data.model.MessageType
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.model.StreamBuffer
import com.claudecode.remote.data.model.toFileInfo
import com.claudecode.remote.data.remote.AuthSessionManager
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.data.remote.WakeupRequest
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class MessageRepository(
    private val webSocket: RelayWebSocket,
    private val relayApiProvider: () -> RelayApi,
    private val authSessionManager: AuthSessionManager,
    private val tokenStore: TokenStore,
    private val context: Context
) {
    companion object {
        private const val MAX_PROJECT_MESSAGES = 5000
        private const val FILE_CHUNK_SIZE = 64 * 1024
        private const val FILE_UPLOAD_TIMEOUT_MS = 120_000L
        private const val FILE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000L
        private const val FILE_TRANSFER_KIND_DOWNLOAD = "download"
        private const val FILE_SYNC_KIND_DOWNLOAD_REQUEST = "download_request"
        private const val MAX_PREVIEW_EDGE = 480
        private const val MAX_PREVIEW_BYTES = 220 * 1024
    }

    private data class UploadAck(
        val filePath: String,
        val kind: String?,
        val mimeType: String?,
        val previewDataUrl: String?
    )

    private data class CachedAttachmentMeta(
        val name: String,
        val size: Long,
        val mimeType: String
    )

    private data class AppliedSyncWindow(
        val earliestSeq: Long?,
        val highestSeq: Long
    )

    private data class PendingDownloadRequest(
        val projectId: String,
        val messageId: String,
        val attachment: MessageAttachment,
        val deferred: CompletableDeferred<MessageAttachment>
    )

    private data class PendingDownloadTransfer(
        val request: PendingDownloadRequest,
        val targetFile: File,
        val output: FileOutputStream,
        val mimeType: String,
        var nextSeq: Long = 0L
    )

    private val db = AppDatabase.getInstance(context)
    private val messageDao = db.messageDao()
    private val sessionDao = db.sessionDao()
    private val streamBuffers = mutableMapOf<String, StreamBuffer>()
    private val pendingUploadAcks = ConcurrentHashMap<String, CompletableDeferred<UploadAck>>()
    private val pendingDownloadRequests = ConcurrentHashMap<String, PendingDownloadRequest>()
    private val pendingDownloadTransfers = ConcurrentHashMap<String, PendingDownloadTransfer>()
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    suspend fun requestProjectSync(
        projectId: String,
        agentId: String? = null,
        afterSeqOverride: Long? = null,
        beforeSeq: Long? = null,
        shouldWakeAgent: Boolean = true
    ) {
        if (shouldWakeAgent) {
            wakeupAgent(agentId)
        }
        val storedAfterSeq = sessionDao.getSessionByProjectId(projectId)?.lastSyncSeq ?: 0L
        var afterSeq = afterSeqOverride ?: storedAfterSeq

        if (beforeSeq == null && afterSeqOverride == null && storedAfterSeq > 0L) {
            val syncBounds = messageDao.getProjectSyncBounds(projectId)
            val earliestLoadedSeq = syncBounds?.earliestSyncSeq ?: 0L
            val latestLoadedSeq = syncBounds?.latestSyncSeq ?: 0L
            val messageCount = syncBounds?.messageCount ?: 0
            val expectedEarliestSeq = maxOf(1L, storedAfterSeq - messageCount + 1L)
            val hasGap = messageCount == 0
                || latestLoadedSeq < storedAfterSeq
                || (earliestLoadedSeq > 0L && earliestLoadedSeq > expectedEarliestSeq)
            if (hasGap) {
                CrashLogger.logInfo(
                    "MessageRepository",
                    "Detected incomplete local sync for projectId=$projectId storedAfterSeq=$storedAfterSeq earliest=$earliestLoadedSeq latest=$latestLoadedSeq count=$messageCount; forcing full resync"
                )
                afterSeq = 0L
            }
        }

        webSocket.send(
            Envelope(
                id = UUID.randomUUID().toString(),
                event = Events.SESSION_SYNC_REQUEST,
                projectId = projectId,
                payload = buildJsonObject {
                    put("after_seq", JsonPrimitive(afterSeq))
                    beforeSeq?.takeIf { it > 0L }?.let {
                        put("before_seq", JsonPrimitive(it))
                    }
                },
                ts = System.currentTimeMillis()
            )
        )
    }

    suspend fun requestProjectSyncs(sessions: List<Session>) {
        sessions.forEach { session ->
            if (session.projectId.isNotBlank()) {
                requestProjectSync(session.projectId, session.agentId)
            }
        }
    }

    suspend fun sendStopTask(projectId: String) {
        webSocket.send(
            Envelope(
                id = UUID.randomUUID().toString(),
                event = Events.TASK_STOP,
                projectId = projectId,
                ts = System.currentTimeMillis()
            )
        )
    }

    suspend fun preparePendingAttachments(projectId: String, uris: List<Uri>): List<MessageAttachment> =
        withContext(Dispatchers.IO) {
            uris.mapNotNull { uri ->
                runCatching { cacheAttachment(projectId, uri) }
                    .onFailure { error ->
                        CrashLogger.logError(
                            "MessageRepository",
                            "Failed to cache local attachment for projectId=$projectId uri=$uri",
                            error as? Exception ?: Exception(error)
                        )
                    }
                    .getOrNull()
            }
        }

    suspend fun sendMessage(
        projectId: String,
        content: String,
        attachments: List<MessageAttachment> = emptyList(),
        agentId: String? = null
    ) = withContext(Dispatchers.IO) {
        wakeupAgent(agentId)

        val normalizedAttachments = attachments.map(::normalizeAttachment)
        val trimmedContent = content.trim()
        if (trimmedContent.isEmpty() && normalizedAttachments.isEmpty()) {
            return@withContext
        }

        val uploadedAttachments = normalizedAttachments.map { attachment ->
            uploadAttachment(projectId, attachment)
        }
        val messageContent = if (trimmedContent.isNotEmpty()) content else buildAttachmentOnlyPrompt(uploadedAttachments)
        val runId = UUID.randomUUID().toString()
        val streamId = "$runId:assistant"
        val envelope = Envelope(
            id = runId,
            event = Events.MESSAGE_SEND,
            projectId = projectId,
            streamId = streamId,
            payload = buildJsonObject {
                put("content", JsonPrimitive(messageContent))
                if (uploadedAttachments.isNotEmpty()) {
                    put("attachments", JsonArray(uploadedAttachments.map(::attachmentToJson)))
                }
            },
            ts = System.currentTimeMillis()
        )

        val optimisticAttachments = uploadedAttachments.map { uploaded ->
            mergeAttachment(
                existing = normalizedAttachments.firstOrNull { it.id == uploaded.id },
                incoming = uploaded
            )
        }

        addMessage(
            Message(
                id = envelope.id,
                projectId = projectId,
                role = MessageRole.USER,
                content = messageContent,
                type = if (optimisticAttachments.isNotEmpty()) MessageType.FILE else MessageType.TEXT,
                attachments = optimisticAttachments,
                timestamp = envelope.ts
            )
        )

        webSocket.send(envelope)
    }

    suspend fun downloadAttachment(
        projectId: String,
        messageId: String,
        attachment: MessageAttachment,
        agentId: String? = null
    ): MessageAttachment = withContext(Dispatchers.IO) {
        if (!attachment.localUri.isNullOrBlank()) {
            return@withContext attachment
        }
        val desktopFilePath = attachment.filePath?.trim().orEmpty()
        if (desktopFilePath.isBlank()) {
            throw IllegalStateException("Attachment does not expose a downloadable file path.")
        }

        wakeupAgent(agentId)

        val transferId = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<MessageAttachment>()
        val request = PendingDownloadRequest(
            projectId = projectId,
            messageId = messageId,
            attachment = attachment,
            deferred = deferred
        )
        pendingDownloadRequests[transferId] = request

        try {
            webSocket.send(
                Envelope(
                    id = transferId,
                    event = Events.FILE_SYNC,
                    projectId = projectId,
                    streamId = transferId,
                    payload = buildJsonObject {
                        put("kind", JsonPrimitive(FILE_SYNC_KIND_DOWNLOAD_REQUEST))
                        put("transfer_id", JsonPrimitive(transferId))
                        put("message_id", JsonPrimitive(messageId))
                        put("attachment_id", JsonPrimitive(attachment.id))
                        put("file_name", JsonPrimitive(attachment.name))
                        put("file_path", JsonPrimitive(desktopFilePath))
                        put("mime_type", JsonPrimitive(attachment.mimeType))
                    },
                    ts = System.currentTimeMillis()
                )
            )

            withTimeout(FILE_DOWNLOAD_TIMEOUT_MS) { deferred.await() }
        } finally {
            pendingDownloadRequests.remove(transferId)
            pendingDownloadTransfers.remove(transferId)?.let { transfer ->
                runCatching { transfer.output.close() }
                runCatching {
                    if (transfer.targetFile.exists()) {
                        transfer.targetFile.delete()
                    }
                }
            }
        }
    }

    suspend fun processEnvelope(envelope: Envelope) {
        val projectId = envelope.projectId ?: return
        when (envelope.event) {
            Events.MESSAGE_CHUNK -> {
                val streamId = envelope.streamId ?: return
                val payloadObj = envelope.payload?.jsonObject ?: return
                val seq = payloadObj["seq"]?.jsonPrimitive?.longOrNull ?: envelope.seq ?: 0L
                val chunk = payloadObj["content"]?.jsonPrimitive?.content ?: return
                if (chunk.isBlank()) return

                val existingBuffer = streamBuffers[streamId]
                val buffer = if (existingBuffer != null) {
                    existingBuffer
                } else {
                    val existingMessage = messageDao.getMessageById(streamId)
                    StreamBuffer(
                        streamId = streamId,
                        startedAt = existingMessage?.timestamp ?: envelope.ts,
                        baseContent = existingMessage?.content.orEmpty()
                    ).also { streamBuffers[streamId] = it }
                }
                if (buffer.chunks.containsKey(seq)) {
                    return
                }
                buffer.chunks[seq] = chunk

                val assembled = buffer.assembledContent()
                upsertStreamingMessage(projectId, streamId, assembled, isStreaming = true, timestamp = buffer.startedAt)
            }

            Events.MESSAGE_DONE -> {
                val streamId = envelope.streamId ?: return
                val buffer = streamBuffers[streamId]
                if (buffer != null) {
                    buffer.isDone = true
                    val assembled = buffer.assembledContent()
                    upsertStreamingMessage(projectId, streamId, assembled, isStreaming = false, timestamp = buffer.startedAt)
                    streamBuffers.remove(streamId)
                } else {
                    val existingMessage = messageDao.getMessageById(streamId)
                    if (existingMessage != null) {
                        upsertStreamingMessage(
                            projectId = projectId,
                            streamId = streamId,
                            content = existingMessage.content,
                            isStreaming = false,
                            timestamp = existingMessage.timestamp
                        )
                    }
                }
                sessionDao.resetRunningState(projectId)
            }

            Events.MESSAGE_ERROR -> {
                val streamId = envelope.streamId
                if (streamId != null) {
                    streamBuffers.remove(streamId)
                    val existingMessage = messageDao.getMessageById(streamId)
                    upsertStreamingMessage(
                        projectId = projectId,
                        streamId = streamId,
                        content = existingMessage?.content?.ifBlank { "[Error receiving response]" }
                            ?: "[Error receiving response]",
                        isStreaming = false,
                        timestamp = existingMessage?.timestamp ?: envelope.ts
                    )
                }
                sessionDao.resetRunningState(projectId)
            }

            Events.FILE_UPLOAD -> {
                val payloadObj = envelope.payload?.jsonObject ?: return
                val transferKind = payloadObj["transfer_kind"]?.jsonPrimitive?.contentOrNull?.trim()
                if (!transferKind.equals(FILE_TRANSFER_KIND_DOWNLOAD, ignoreCase = true)) {
                    return
                }

                val fileId = payloadObj["file_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (fileId.isBlank()) {
                    return
                }

                val request = pendingDownloadRequests[fileId] ?: return
                val fileName = payloadObj["file_name"]?.jsonPrimitive?.contentOrNull?.trim()
                    .takeUnless { it.isNullOrBlank() }
                    ?: request.attachment.name
                val mimeType = payloadObj["mime_type"]?.jsonPrimitive?.contentOrNull?.trim()
                    .takeUnless { it.isNullOrBlank() }
                    ?: request.attachment.mimeType
                val targetFile = createDownloadTargetFile(projectId, fileName)
                pendingDownloadTransfers.remove(fileId)?.let { staleTransfer ->
                    runCatching { staleTransfer.output.close() }
                    runCatching { staleTransfer.targetFile.delete() }
                }
                pendingDownloadTransfers[fileId] = PendingDownloadTransfer(
                    request = request,
                    targetFile = targetFile,
                    output = FileOutputStream(targetFile),
                    mimeType = mimeType
                )
            }

            Events.FILE_CHUNK -> {
                val payloadObj = envelope.payload?.jsonObject ?: return
                val fileId = payloadObj["file_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (fileId.isBlank()) {
                    return
                }
                val transfer = pendingDownloadTransfers[fileId] ?: return
                val chunk = payloadObj["chunk"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                val seq = payloadObj["seq"]?.jsonPrimitive?.longOrNull ?: envelope.seq ?: 0L
                if (chunk.isBlank()) {
                    return
                }
                if (seq < transfer.nextSeq) {
                    return
                }
                if (seq > transfer.nextSeq) {
                    throw IllegalStateException("Attachment download chunk out of order: expected=${transfer.nextSeq} actual=$seq")
                }

                val bytes = Base64.decode(chunk, Base64.DEFAULT)
                transfer.output.write(bytes)
                transfer.nextSeq = seq + 1L
            }

            Events.FILE_DONE -> {
                val payloadObj = envelope.payload?.jsonObject ?: return
                val fileId = payloadObj["file_id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (fileId.isBlank()) {
                    return
                }

                val transfer = pendingDownloadTransfers.remove(fileId)
                if (transfer != null) {
                    runCatching { transfer.output.flush() }
                    runCatching { transfer.output.close() }
                    val updatedAttachment = finalizeDownloadedAttachment(transfer)
                    persistDownloadedAttachment(
                        messageId = transfer.request.messageId,
                        attachmentId = transfer.request.attachment.id,
                        updatedAttachment = updatedAttachment
                    )
                    transfer.request.deferred.complete(updatedAttachment)
                    return
                }

                pendingUploadAcks.remove(fileId)?.complete(
                    UploadAck(
                        filePath = payloadObj["file_path"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty(),
                        kind = payloadObj["kind"]?.jsonPrimitive?.contentOrNull?.trim(),
                        mimeType = payloadObj["mime_type"]?.jsonPrimitive?.contentOrNull?.trim(),
                        previewDataUrl = payloadObj["preview_data_url"]?.jsonPrimitive?.contentOrNull?.trim()
                    )
                )
            }

            Events.FILE_ERROR -> {
                val fileId = envelope.streamId?.trim().orEmpty()
                if (fileId.isBlank()) {
                    return
                }

                val error = envelope.payload?.jsonObject
                    ?.get("error")
                    ?.jsonPrimitive
                    ?.contentOrNull
                    ?.trim()
                    .takeUnless { it.isNullOrBlank() }
                    ?: "Desktop failed to receive attachment."
                pendingDownloadTransfers.remove(fileId)?.let { transfer ->
                    runCatching { transfer.output.close() }
                    runCatching { transfer.targetFile.delete() }
                    transfer.request.deferred.completeExceptionally(IllegalStateException(error))
                    return
                }
                pendingDownloadRequests.remove(fileId)?.let { request ->
                    request.deferred.completeExceptionally(IllegalStateException(error))
                    return
                }
                pendingUploadAcks.remove(fileId)?.completeExceptionally(IllegalStateException(error))
            }

            Events.SESSION_SYNC -> {
                val payloadObj = envelope.payload?.jsonObject ?: return
                val provider = payloadObj["provider"]?.jsonPrimitive?.contentOrNull?.trim()
                    .takeUnless { it.isNullOrBlank() } ?: "claude"
                val model = payloadObj["model"]?.jsonPrimitive?.contentOrNull?.trim()
                    .takeUnless { it.isNullOrBlank() }
                val isRunning = payloadObj["isRunning"]?.jsonPrimitive?.booleanOrNull ?: false
                val queuedCount = payloadObj["queuedCount"]?.jsonPrimitive?.intOrNull ?: 0
                val currentPrompt = payloadObj["currentPrompt"]?.jsonPrimitive?.contentOrNull?.trim()
                    .takeUnless { it.isNullOrBlank() }
                val currentStartedAt = payloadObj["currentStartedAt"]?.jsonPrimitive?.longOrNull
                val queuePreview = payloadObj["queue"]?.jsonArray
                    ?.firstOrNull()
                    ?.jsonObject
                    ?.get("prompt")
                    ?.jsonPrimitive
                    ?.contentOrNull
                    ?.trim()
                    .takeUnless { it.isNullOrBlank() }
                sessionDao.updateSessionRuntime(
                    projectId = projectId,
                    cliProvider = provider,
                    cliModel = model,
                    isRunning = isRunning,
                    queuedCount = queuedCount,
                    currentPrompt = currentPrompt,
                    queuePreview = queuePreview,
                    currentStartedAt = currentStartedAt,
                    lastActiveAt = envelope.ts
                )
                val syncObj = payloadObj["sync"]?.jsonObject
                if (syncObj != null) {
                    val latestSeq = syncObj["latest_seq"]?.jsonPrimitive?.longOrNull ?: 0L
                    val requestedAfterSeq = syncObj["after_seq"]?.jsonPrimitive?.longOrNull ?: 0L
                    val requestedBeforeSeq = syncObj["before_seq"]?.jsonPrimitive?.longOrNull
                        ?.takeIf { it > 0L }
                    val truncated = syncObj["truncated"]?.jsonPrimitive?.booleanOrNull ?: false
                    val items = syncObj["items"]?.jsonArray ?: JsonArray(emptyList())
                    CrashLogger.logInfo(
                        "MessageRepository",
                        "Received session.sync v2 for projectId=$projectId items=${items.size} latestSeq=$latestSeq afterSeq=$requestedAfterSeq beforeSeq=${requestedBeforeSeq ?: 0L} truncated=$truncated running=$isRunning queued=$queuedCount"
                    )
                    val applied = applyProjectSyncDelta(
                        projectId = projectId,
                        rawItems = items,
                        latestSeq = latestSeq,
                        fallbackTimestamp = envelope.ts,
                        requestAfterSeq = requestedAfterSeq,
                        requestBeforeSeq = requestedBeforeSeq,
                        truncated = truncated
                    )
                    maybeRequestProjectBackfill(
                        projectId = projectId,
                        requestAfterSeq = requestedAfterSeq,
                        requestBeforeSeq = requestedBeforeSeq,
                        truncated = truncated,
                        earliestReceivedSeq = applied.earliestSeq
                    )
                } else {
                    val messages = payloadObj["messages"]?.jsonArray ?: JsonArray(emptyList())
                    val activities = payloadObj["activities"]?.jsonArray ?: JsonArray(emptyList())
                    CrashLogger.logInfo(
                        "MessageRepository",
                        "Received legacy session.sync for projectId=$projectId messages=${messages.size} activities=${activities.size} running=$isRunning queued=$queuedCount"
                    )
                    mergeProjectMessagesFromDesktop(projectId, messages, activities, envelope.ts)
                }
            }
        }
    }

    fun getMessagesForProject(projectId: String): Flow<List<Message>> =
        messageDao.getMessagesByProject(projectId).map { entities ->
            entities.map { it.toMessage() }
        }

    fun getSessionForProject(projectId: String): Flow<Session?> =
        sessionDao.observeSessionByProjectId(projectId).map { entity ->
            entity?.toSession()
        }

    private suspend fun addMessage(message: Message) {
        messageDao.insertMessage(message.toEntity())
    }

    private suspend fun applyProjectSyncDelta(
        projectId: String,
        rawItems: JsonArray,
        latestSeq: Long,
        fallbackTimestamp: Long,
        requestAfterSeq: Long,
        requestBeforeSeq: Long?,
        truncated: Boolean
    ): AppliedSyncWindow {
        var earliestSeq: Long? = null
        var highestSeq = 0L

        db.withTransaction {
            val currentLastSeq = sessionDao.getSessionByProjectId(projectId)?.lastSyncSeq ?: 0L
            rawItems.forEachIndexed { index, item ->
                val entity = runCatching {
                    parseSyncItem(projectId, item.jsonObject, fallbackTimestamp)
                }.onFailure { error ->
                    CrashLogger.logError(
                        "MessageRepository",
                        "Failed to parse sync item at index=$index for projectId=$projectId",
                        error as? Exception ?: Exception(error)
                    )
                }.getOrNull() ?: return@forEachIndexed

                val existing = messageDao.getMessageById(entity.id)
                if (existing != null && existing.syncSeq > entity.syncSeq) {
                    return@forEachIndexed
                }

                earliestSeq = earliestSeq?.let { minOf(it, entity.syncSeq) } ?: entity.syncSeq
                highestSeq = maxOf(highestSeq, entity.syncSeq)
                messageDao.insertMessage(mergeMessageEntity(existing, entity))
            }

            messageDao.pruneProjectMessages(projectId, MAX_PROJECT_MESSAGES)
            val nextLastSyncSeq = when {
                requestBeforeSeq != null -> maxOf(currentLastSeq, highestSeq)
                rawItems.isEmpty() && !truncated -> maxOf(currentLastSeq, latestSeq)
                truncated -> maxOf(currentLastSeq, highestSeq)
                else -> maxOf(currentLastSeq, latestSeq, highestSeq)
            }
            sessionDao.updateLastSyncSeq(projectId, nextLastSyncSeq)
        }

        return AppliedSyncWindow(
            earliestSeq = earliestSeq,
            highestSeq = highestSeq
        )
    }

    private suspend fun maybeRequestProjectBackfill(
        projectId: String,
        requestAfterSeq: Long,
        requestBeforeSeq: Long?,
        truncated: Boolean,
        earliestReceivedSeq: Long?
    ) {
        if (!truncated || earliestReceivedSeq == null || earliestReceivedSeq <= 0L) {
            return
        }

        val lowerBound = requestAfterSeq + 1L
        if (earliestReceivedSeq <= lowerBound) {
            return
        }
        if (requestBeforeSeq != null && earliestReceivedSeq >= requestBeforeSeq) {
            CrashLogger.logInfo(
                "MessageRepository",
                "Skipping backfill loop for projectId=$projectId because earliestReceivedSeq=$earliestReceivedSeq requestBeforeSeq=$requestBeforeSeq"
            )
            return
        }

        val agentId = sessionDao.getSessionByProjectId(projectId)?.agentId
        CrashLogger.logInfo(
            "MessageRepository",
            "Requesting sync backfill for projectId=$projectId afterSeq=$requestAfterSeq beforeSeq=$earliestReceivedSeq lowerBound=$lowerBound"
        )
        requestProjectSync(
            projectId = projectId,
            agentId = agentId,
            afterSeqOverride = requestAfterSeq,
            beforeSeq = earliestReceivedSeq,
            shouldWakeAgent = false
        )
    }

    private suspend fun mergeProjectMessagesFromDesktop(
        projectId: String,
        rawMessages: JsonArray,
        rawActivities: JsonArray,
        fallbackTimestamp: Long
    ) {
        val currentLastSeq = sessionDao.getSessionByProjectId(projectId)?.lastSyncSeq ?: 0L
        val messages = buildList {
            rawMessages.forEachIndexed { index, item ->
                runCatching {
                    parseDesktopMessage(
                        projectId = projectId,
                        messageObj = item.jsonObject,
                        fallbackTimestamp = fallbackTimestamp,
                        syncSeq = currentLastSeq + index + 1L
                    )
                }.onFailure { error ->
                    CrashLogger.logError(
                        "MessageRepository",
                        "Failed to parse desktop message at index=$index for projectId=$projectId",
                        error as? Exception ?: Exception(error)
                    )
                }.getOrNull()?.let { entity ->
                    add(index to entity)
                }
            }
            rawActivities.forEachIndexed { index, item ->
                runCatching {
                    parseDesktopActivity(
                        projectId = projectId,
                        activityObj = item.jsonObject,
                        fallbackTimestamp = fallbackTimestamp,
                        syncSeq = currentLastSeq + rawMessages.size + index + 1L
                    )
                }.onFailure { error ->
                    CrashLogger.logError(
                        "MessageRepository",
                        "Failed to parse desktop activity at index=$index for projectId=$projectId",
                        error as? Exception ?: Exception(error)
                    )
                }.getOrNull()?.let { entity ->
                    add((rawMessages.size + index) to entity)
                }
            }
        }.sortedWith(compareBy<Pair<Int, MessageEntity>>({ it.second.timestamp }, { it.first }))
            .map { it.second }

        if (messages.isEmpty()) {
            CrashLogger.logInfo(
                "MessageRepository",
                "Desktop sync contained no parsable messages for projectId=$projectId"
            )
            return
        }

        db.withTransaction {
            messages.forEach { entity ->
                val existing = messageDao.getMessageById(entity.id)
                messageDao.insertMessage(mergeMessageEntity(existing, entity))
            }
            messageDao.pruneProjectMessages(projectId, MAX_PROJECT_MESSAGES)
            sessionDao.updateLastSyncSeq(projectId, currentLastSeq + messages.size)
        }
    }

    private suspend fun upsertStreamingMessage(
        projectId: String,
        streamId: String,
        content: String,
        isStreaming: Boolean,
        timestamp: Long
    ) {
        val existing = messageDao.getMessageById(streamId)
        val attachments = existing?.toMessage()?.attachments ?: emptyList()
        val message = Message(
            id = streamId,
            projectId = projectId,
            role = MessageRole.ASSISTANT,
            content = content,
            type = if (attachments.isNotEmpty()) MessageType.FILE else MessageType.TEXT,
            attachments = attachments,
            streamId = streamId,
            timestamp = timestamp,
            syncSeq = 0L,
            isStreaming = isStreaming
        )
        messageDao.insertMessage(message.toEntity())
    }

    private suspend fun wakeupAgent(agentId: String?) {
        if (agentId.isNullOrBlank()) {
            return
        }

        val deviceId = tokenStore.getDeviceId().orEmpty()
        val token = authSessionManager.ensureValidToken(deviceId).getOrElse {
            return
        }

        try {
            relayApiProvider().wakeupAgent(
                auth = "Bearer $token",
                request = WakeupRequest(agentId)
            )
            CrashLogger.logInfo("MessageRepository", "Wakeup requested for agentId=$agentId")
        } catch (e: Exception) {
            CrashLogger.logError("MessageRepository", "Wakeup request failed for agentId=$agentId", e)
        }
    }

    private fun normalizeAttachment(attachment: MessageAttachment): MessageAttachment {
        val inferredKind = when {
            attachment.kind.isNotBlank() -> attachment.kind.lowercase()
            attachment.mimeType.startsWith("image/", ignoreCase = true) -> "image"
            else -> "file"
        }

        return attachment.copy(
            id = attachment.id.ifBlank { UUID.randomUUID().toString() },
            name = attachment.name.ifBlank { "attachment" },
            kind = inferredKind,
            mimeType = attachment.mimeType.ifBlank {
                if (inferredKind == "image") "image/*" else "application/octet-stream"
            }
        )
    }

    private fun attachmentToJson(attachment: MessageAttachment): JsonObject =
        buildJsonObject {
            put("id", JsonPrimitive(attachment.id))
            put("name", JsonPrimitive(attachment.name))
            put("path", JsonPrimitive(attachment.filePath.orEmpty()))
            put("size", JsonPrimitive(attachment.size))
            put("kind", JsonPrimitive(attachment.kind))
            put("mimeType", JsonPrimitive(attachment.mimeType))
            attachment.previewDataUrl?.takeIf { it.isNotBlank() }?.let {
                put("previewDataUrl", JsonPrimitive(it))
            }
        }

    private suspend fun uploadAttachment(projectId: String, attachment: MessageAttachment): MessageAttachment {
        val deferred = CompletableDeferred<UploadAck>()
        pendingUploadAcks[attachment.id] = deferred

        try {
            webSocket.send(
                Envelope(
                    id = attachment.id,
                    event = Events.FILE_UPLOAD,
                    projectId = projectId,
                    payload = buildJsonObject {
                        put("file_name", JsonPrimitive(attachment.name))
                        put("file_size", JsonPrimitive(attachment.size))
                        put("mime_type", JsonPrimitive(attachment.mimeType))
                    },
                    ts = System.currentTimeMillis()
                )
            )

            openAttachmentInputStream(attachment).use { inputStream ->
                if (inputStream == null) {
                    throw IllegalStateException("Attachment input stream is unavailable.")
                }

                val buffer = ByteArray(FILE_CHUNK_SIZE)
                var seq = 0L
                var bytesRead: Int

                while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                    val currentSeq = seq++
                    val chunk = Base64.encodeToString(buffer, 0, bytesRead, Base64.NO_WRAP)
                    webSocket.send(
                        Envelope(
                            id = UUID.randomUUID().toString(),
                            event = Events.FILE_CHUNK,
                            projectId = projectId,
                            streamId = attachment.id,
                            seq = currentSeq,
                            payload = buildJsonObject {
                                put("file_id", JsonPrimitive(attachment.id))
                                put("chunk", JsonPrimitive(chunk))
                                put("seq", JsonPrimitive(currentSeq))
                            },
                            ts = System.currentTimeMillis()
                        )
                    )
                }
            }

            webSocket.send(
                Envelope(
                    id = UUID.randomUUID().toString(),
                    event = Events.FILE_DONE,
                    projectId = projectId,
                    streamId = attachment.id,
                    payload = buildJsonObject {
                        put("file_id", JsonPrimitive(attachment.id))
                        put("file_name", JsonPrimitive(attachment.name))
                    },
                    ts = System.currentTimeMillis()
                )
            )

            val ack = withTimeout(FILE_UPLOAD_TIMEOUT_MS) { deferred.await() }
            if (ack.filePath.isBlank()) {
                throw IllegalStateException("Desktop did not return a usable attachment path.")
            }

            return mergeAttachment(
                existing = attachment,
                incoming = attachment.copy(
                    filePath = ack.filePath,
                    kind = ack.kind ?: attachment.kind,
                    mimeType = ack.mimeType ?: attachment.mimeType,
                    previewDataUrl = ack.previewDataUrl ?: attachment.previewDataUrl
                )
            )
        } finally {
            pendingUploadAcks.remove(attachment.id)
        }
    }

    private fun createDownloadTargetFile(projectId: String, fileName: String): File {
        val downloadRoot = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: context.cacheDir
        val downloadDirectory = File(
            downloadRoot,
            "chat-downloads/${Uri.encode(projectId.ifBlank { "shared" })}"
        ).apply { mkdirs() }
        return uniqueFile(downloadDirectory, sanitizeFileName(fileName))
    }

    private fun finalizeDownloadedAttachment(transfer: PendingDownloadTransfer): MessageAttachment {
        val requestAttachment = transfer.request.attachment
        val targetFile = transfer.targetFile
        val contentUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            targetFile
        )
        val resolvedMimeType = transfer.mimeType.ifBlank {
            guessMimeType(targetFile.name, requestAttachment.mimeType.ifBlank { "application/octet-stream" })
        }
        val resolvedKind = if (
            requestAttachment.kind.isNotBlank()
            && requestAttachment.kind.equals("image", ignoreCase = true)
        ) {
            "image"
        } else if (isImageMimeType(resolvedMimeType) || isImageFileName(targetFile.name)) {
            "image"
        } else {
            "file"
        }

        return requestAttachment.copy(
            size = if (targetFile.length() > 0L) targetFile.length() else requestAttachment.size,
            kind = resolvedKind,
            mimeType = resolvedMimeType,
            localUri = contentUri.toString(),
            previewDataUrl = requestAttachment.previewDataUrl
                ?: if (resolvedKind == "image") buildImagePreviewDataUrl(targetFile) else null
        )
    }

    private suspend fun persistDownloadedAttachment(
        messageId: String,
        attachmentId: String,
        updatedAttachment: MessageAttachment
    ) {
        val existing = messageDao.getMessageById(messageId) ?: return
        val existingAttachments = deserializeAttachments(existing.attachmentsJson).ifEmpty {
            legacyAttachment(existing.fileName, existing.fileSize, existing.mimeType, existing.filePath)?.let(::listOf)
                ?: emptyList()
        }
        if (existingAttachments.isEmpty()) {
            return
        }

        val mergedAttachments = existingAttachments.map { candidate ->
            if (candidate.id == attachmentId || attachmentsMatch(candidate, updatedAttachment)) {
                mergeAttachment(candidate, updatedAttachment)
            } else {
                candidate
            }
        }
        val primary = mergedAttachments.firstOrNull()
        messageDao.insertMessage(
            existing.copy(
                fileName = primary?.name ?: existing.fileName,
                fileSize = primary?.size ?: existing.fileSize,
                mimeType = primary?.mimeType ?: existing.mimeType,
                filePath = primary?.filePath ?: existing.filePath,
                attachmentsJson = serializeAttachments(mergedAttachments)
            )
        )
    }

    private fun openAttachmentInputStream(attachment: MessageAttachment) =
        when {
            !attachment.localUri.isNullOrBlank() -> context.contentResolver.openInputStream(Uri.parse(attachment.localUri))
            !attachment.filePath.isNullOrBlank() -> FileInputStream(File(attachment.filePath))
            else -> null
        }

    private fun cacheAttachment(projectId: String, uri: Uri): MessageAttachment {
        val meta = readAttachmentMeta(uri)
        val cacheDirectory = File(
            context.cacheDir,
            "chat-attachments/${Uri.encode(projectId.ifBlank { "shared" })}"
        ).apply { mkdirs() }
        val targetFile = uniqueFile(cacheDirectory, sanitizeFileName(meta.name))
        context.contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(targetFile).use { output ->
                input.copyTo(output)
            }
        } ?: throw IllegalStateException("Cannot open attachment: $uri")

        val kind = if (isImageMimeType(meta.mimeType) || isImageFileName(meta.name)) "image" else "file"
        val resolvedSize = if (meta.size > 0L) meta.size else targetFile.length()

        return MessageAttachment(
            id = UUID.randomUUID().toString(),
            name = meta.name,
            size = resolvedSize,
            kind = kind,
            mimeType = meta.mimeType.ifBlank {
                if (kind == "image") "image/*" else "application/octet-stream"
            },
            filePath = targetFile.absolutePath,
            localUri = Uri.fromFile(targetFile).toString(),
            previewDataUrl = if (kind == "image") buildImagePreviewDataUrl(targetFile) else null
        )
    }

    private fun readAttachmentMeta(uri: Uri): CachedAttachmentMeta {
        var fileName = "attachment.bin"
        var fileSize = 0L
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex >= 0) {
                    fileName = cursor.getString(nameIndex).orEmpty().ifBlank { fileName }
                }
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (sizeIndex >= 0) {
                    fileSize = cursor.getLong(sizeIndex)
                }
            }
        }
        val mimeType = context.contentResolver.getType(uri)
            ?: guessMimeType(fileName, if (isImageFileName(fileName)) "image/*" else "application/octet-stream")
        return CachedAttachmentMeta(fileName, fileSize, mimeType)
    }

    private fun buildImagePreviewDataUrl(file: File): String? {
        val options = BitmapFactory.Options().apply {
            inJustDecodeBounds = true
            BitmapFactory.decodeFile(file.absolutePath, this)
        }
        if (options.outWidth <= 0 || options.outHeight <= 0) {
            return null
        }

        val sampleSize = calculateSampleSize(options.outWidth, options.outHeight, MAX_PREVIEW_EDGE)
        val bitmap = BitmapFactory.decodeFile(
            file.absolutePath,
            BitmapFactory.Options().apply { inSampleSize = sampleSize }
        ) ?: return null

        val scaledBitmap = scaleBitmapIfNeeded(bitmap)
        val output = ByteArrayOutputStream()
        val format = if (guessMimeType(file.name).equals("image/png", ignoreCase = true)) {
            Bitmap.CompressFormat.PNG
        } else {
            Bitmap.CompressFormat.JPEG
        }
        var quality = 88
        do {
            output.reset()
            scaledBitmap.compress(format, quality, output)
            quality -= 6
        } while (output.size() > MAX_PREVIEW_BYTES && quality >= 56 && format == Bitmap.CompressFormat.JPEG)

        if (scaledBitmap !== bitmap) {
            scaledBitmap.recycle()
        }
        bitmap.recycle()

        val base64 = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
        val mimeType = if (format == Bitmap.CompressFormat.PNG) "image/png" else "image/jpeg"
        return "data:$mimeType;base64,$base64"
    }

    private fun calculateSampleSize(width: Int, height: Int, targetEdge: Int): Int {
        var sampleSize = 1
        while (width / sampleSize > targetEdge * 2 || height / sampleSize > targetEdge * 2) {
            sampleSize *= 2
        }
        return sampleSize.coerceAtLeast(1)
    }

    private fun scaleBitmapIfNeeded(bitmap: Bitmap): Bitmap {
        val longestEdge = maxOf(bitmap.width, bitmap.height)
        if (longestEdge <= MAX_PREVIEW_EDGE) {
            return bitmap
        }
        val ratio = MAX_PREVIEW_EDGE.toFloat() / longestEdge.toFloat()
        val width = (bitmap.width * ratio).toInt().coerceAtLeast(1)
        val height = (bitmap.height * ratio).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(bitmap, width, height, true)
    }

    private fun buildAttachmentOnlyPrompt(attachments: List<MessageAttachment>): String {
        if (attachments.size == 1) {
            val attachment = attachments.first()
            return if (attachment.isImage) {
                "Please inspect the attached image: ${attachment.name}"
            } else {
                "Please inspect the attached file: ${attachment.name}"
            }
        }
        return "Please inspect the attached files."
    }

    private fun mergeMessageEntity(existing: MessageEntity?, incoming: MessageEntity): MessageEntity {
        if (existing == null) {
            return incoming
        }

        val mergedAttachments = mergeAttachmentLists(
            deserializeAttachments(existing.attachmentsJson).ifEmpty {
                legacyAttachment(existing.fileName, existing.fileSize, existing.mimeType, existing.filePath)?.let(::listOf)
                    ?: emptyList()
            },
            deserializeAttachments(incoming.attachmentsJson).ifEmpty {
                legacyAttachment(incoming.fileName, incoming.fileSize, incoming.mimeType, incoming.filePath)?.let(::listOf)
                    ?: emptyList()
            }
        )
        val primary = mergedAttachments.firstOrNull()

        return incoming.copy(
            fileName = primary?.name ?: incoming.fileName ?: existing.fileName,
            fileSize = primary?.size ?: incoming.fileSize ?: existing.fileSize,
            mimeType = primary?.mimeType ?: incoming.mimeType ?: existing.mimeType,
            filePath = primary?.filePath ?: incoming.filePath ?: existing.filePath,
            attachmentsJson = serializeAttachments(mergedAttachments),
            streamId = incoming.streamId ?: existing.streamId,
            content = incoming.content.ifBlank { existing.content },
            isStreaming = incoming.isStreaming
        )
    }

    private fun mergeAttachmentLists(
        existing: List<MessageAttachment>,
        incoming: List<MessageAttachment>
    ): List<MessageAttachment> {
        if (existing.isEmpty()) {
            return incoming
        }
        if (incoming.isEmpty()) {
            return existing
        }

        val merged = mutableListOf<MessageAttachment>()
        val consumed = mutableSetOf<Int>()

        incoming.forEach { incomingAttachment ->
            val existingIndex = existing.indexOfFirstIndexed { index, candidate ->
                index !in consumed && attachmentsMatch(candidate, incomingAttachment)
            }
            val existingAttachment = if (existingIndex >= 0) {
                consumed.add(existingIndex)
                existing[existingIndex]
            } else {
                null
            }
            merged += mergeAttachment(existingAttachment, incomingAttachment)
        }

        existing.forEachIndexed { index, attachment ->
            if (index !in consumed) {
                merged += attachment
            }
        }
        return merged
    }

    private fun attachmentsMatch(left: MessageAttachment, right: MessageAttachment): Boolean {
        if (left.id.isNotBlank() && right.id.isNotBlank()) {
            return left.id == right.id
        }
        return left.name.equals(right.name, ignoreCase = true)
            && left.size == right.size
            && left.kind.equals(right.kind, ignoreCase = true)
    }

    private fun mergeAttachment(existing: MessageAttachment?, incoming: MessageAttachment): MessageAttachment {
        if (existing == null) {
            return incoming
        }

        return incoming.copy(
            id = incoming.id.ifBlank { existing.id },
            name = incoming.name.ifBlank { existing.name },
            size = if (incoming.size > 0L) incoming.size else existing.size,
            kind = incoming.kind.ifBlank { existing.kind },
            mimeType = incoming.mimeType.ifBlank { existing.mimeType },
            filePath = incoming.filePath ?: existing.filePath,
            localUri = existing.localUri ?: incoming.localUri,
            previewDataUrl = incoming.previewDataUrl ?: existing.previewDataUrl
        )
    }

    private fun Message.toEntity(): MessageEntity {
        val normalizedAttachments = attachments.ifEmpty {
            fileInfo?.let {
                listOf(
                    MessageAttachment(
                        id = UUID.randomUUID().toString(),
                        name = it.fileName,
                        size = it.fileSize,
                        mimeType = it.mimeType,
                        filePath = it.filePath
                    )
                )
            } ?: emptyList()
        }
        val primary = normalizedAttachments.firstOrNull()
        return MessageEntity(
            id = id,
            projectId = projectId,
            role = role.name,
            content = content,
            type = type.name,
            fileName = primary?.name ?: fileInfo?.fileName,
            fileSize = primary?.size ?: fileInfo?.fileSize,
            mimeType = primary?.mimeType ?: fileInfo?.mimeType,
            filePath = primary?.filePath ?: fileInfo?.filePath,
            attachmentsJson = serializeAttachments(normalizedAttachments),
            streamId = streamId,
            timestamp = timestamp,
            syncSeq = syncSeq,
            isStreaming = isStreaming
        )
    }

    private fun parseDesktopMessage(
        projectId: String,
        messageObj: JsonObject,
        fallbackTimestamp: Long,
        syncSeq: Long
    ): MessageEntity? {
        val id = messageObj["id"]?.jsonPrimitive?.content ?: return null
        val roleValue = messageObj["role"]?.jsonPrimitive?.content?.lowercase() ?: "assistant"
        val attachments = parseDesktopAttachments(messageObj["attachments"]).ifEmpty {
            parseDesktopLegacyAttachment(messageObj)?.let(::listOf) ?: emptyList()
        }
        val content = messageObj["content"]?.jsonPrimitive?.contentOrNull
            ?: attachments.firstOrNull()?.name
            ?: ""
        val createdAt = messageObj["createdAt"]?.jsonPrimitive?.longOrNull
            ?: messageObj["updatedAt"]?.jsonPrimitive?.longOrNull
            ?: fallbackTimestamp
        val status = messageObj["status"]?.jsonPrimitive?.content ?: "done"
        val messageType = when {
            parseMessageType(messageObj["type"]?.jsonPrimitive?.contentOrNull) == MessageType.FILE -> MessageType.FILE
            attachments.isNotEmpty() -> MessageType.FILE
            else -> parseMessageType(messageObj["type"]?.jsonPrimitive?.contentOrNull)
        }

        return Message(
            id = id,
            projectId = projectId,
            role = if (roleValue == "user") MessageRole.USER else MessageRole.ASSISTANT,
            content = if (roleValue == "error") "[Error] $content" else content,
            type = messageType,
            attachments = attachments,
            timestamp = createdAt,
            syncSeq = syncSeq,
            isStreaming = status == "streaming"
        ).toEntity()
    }

    private fun parseDesktopLegacyAttachment(messageObj: JsonObject): MessageAttachment? {
        val fileName = messageObj["fileName"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val filePath = messageObj["filePath"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (fileName.isBlank() && filePath.isBlank()) {
            return null
        }

        val mimeType = messageObj["mimeType"]?.jsonPrimitive?.contentOrNull ?: "application/octet-stream"
        return MessageAttachment(
            id = messageObj["id"]?.jsonPrimitive?.contentOrNull ?: UUID.randomUUID().toString(),
            name = fileName.ifBlank {
                filePath.substringAfterLast('/').substringAfterLast('\\').ifBlank { "attachment" }
            },
            size = messageObj["fileSize"]?.jsonPrimitive?.longOrNull ?: 0L,
            kind = if (mimeType.startsWith("image/", ignoreCase = true) || isImageFileName(fileName)) "image" else "file",
            mimeType = mimeType,
            filePath = filePath.ifBlank { null }
        )
    }

    private fun parseDesktopAttachments(rawAttachments: JsonElement?): List<MessageAttachment> {
        val attachmentArray = runCatching { rawAttachments?.jsonArray }.getOrNull() ?: return emptyList()
        return attachmentArray.mapNotNull { item ->
            val attachmentObj = runCatching { item.jsonObject }.getOrNull() ?: return@mapNotNull null
            val filePath = attachmentObj["path"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val fileName = attachmentObj["name"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val previewDataUrl = attachmentObj["previewDataUrl"]?.jsonPrimitive?.contentOrNull?.trim()
                ?: attachmentObj["preview_data_url"]?.jsonPrimitive?.contentOrNull?.trim()
            if (filePath.isBlank() && fileName.isBlank() && previewDataUrl.isNullOrBlank()) {
                return@mapNotNull null
            }

            val kind = attachmentObj["kind"]?.jsonPrimitive?.contentOrNull?.lowercase().orEmpty()
                .ifBlank {
                    if (previewDataUrl != null || isImageFileName(fileName) || isImageFileName(filePath)) "image" else "file"
                }
            val mimeType = attachmentObj["mimeType"]?.jsonPrimitive?.contentOrNull
                ?: attachmentObj["mime_type"]?.jsonPrimitive?.contentOrNull
                ?: if (kind == "image") "image/*" else "application/octet-stream"
            val fileSize = attachmentObj["size"]?.jsonPrimitive?.longOrNull ?: 0L

            MessageAttachment(
                id = attachmentObj["id"]?.jsonPrimitive?.contentOrNull ?: UUID.randomUUID().toString(),
                name = fileName.ifBlank {
                    filePath.substringAfterLast('/').substringAfterLast('\\').ifBlank { "attachment" }
                },
                size = fileSize,
                kind = kind,
                mimeType = mimeType,
                filePath = filePath.ifBlank { null },
                previewDataUrl = previewDataUrl
            )
        }
    }

    private fun parseDesktopActivity(
        projectId: String,
        activityObj: JsonObject,
        fallbackTimestamp: Long,
        syncSeq: Long
    ): MessageEntity? {
        val id = activityObj["id"]?.jsonPrimitive?.content ?: return null
        val kind = activityObj["kind"]?.jsonPrimitive?.content?.lowercase() ?: return null
        if (kind != "thinking") {
            return null
        }

        val detail = activityObj["detail"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (detail.isEmpty()) {
            return null
        }

        val timestamp = activityObj["createdAt"]?.jsonPrimitive?.longOrNull
            ?: activityObj["updatedAt"]?.jsonPrimitive?.longOrNull
            ?: fallbackTimestamp
        val status = activityObj["status"]?.jsonPrimitive?.content?.lowercase().orEmpty()

        return Message(
            id = "thinking:$id",
            projectId = projectId,
            role = MessageRole.ASSISTANT,
            content = detail,
            type = MessageType.THINKING,
            timestamp = timestamp,
            syncSeq = syncSeq,
            isStreaming = status == "running" || status == "pending"
        ).toEntity()
    }

    private fun parseSyncItem(
        projectId: String,
        itemObj: JsonObject,
        fallbackTimestamp: Long
    ): MessageEntity? {
        val id = itemObj["id"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (id.isBlank()) {
            return null
        }
        val kind = itemObj["kind"]?.jsonPrimitive?.contentOrNull?.lowercase().orEmpty()
        val syncSeq = itemObj["seq"]?.jsonPrimitive?.longOrNull ?: 0L
        val timestamp = itemObj["createdAt"]?.jsonPrimitive?.longOrNull
            ?: itemObj["updatedAt"]?.jsonPrimitive?.longOrNull
            ?: fallbackTimestamp
        val isStreaming = when (itemObj["status"]?.jsonPrimitive?.contentOrNull?.lowercase()) {
            "streaming", "running", "pending" -> true
            else -> false
        }

        return when (kind) {
            "thinking" -> MessageEntity(
                id = id,
                projectId = projectId,
                role = MessageRole.ASSISTANT.name,
                content = itemObj["content"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                type = MessageType.THINKING.name,
                attachmentsJson = null,
                timestamp = timestamp,
                syncSeq = syncSeq,
                isStreaming = isStreaming
            )

            else -> {
                val attachments = parseDesktopAttachments(itemObj["attachments"]).ifEmpty {
                    parseDesktopLegacyAttachment(itemObj)?.let(::listOf) ?: emptyList()
                }
                val content = itemObj["content"]?.jsonPrimitive?.contentOrNull
                    ?: attachments.firstOrNull()?.name
                    ?: ""
                val roleValue = itemObj["role"]?.jsonPrimitive?.contentOrNull?.lowercase() ?: "assistant"
                Message(
                    id = id,
                    projectId = projectId,
                    role = when (roleValue) {
                        "user" -> MessageRole.USER
                        else -> MessageRole.ASSISTANT
                    },
                    content = if (roleValue == "error") "[Error] $content" else content,
                    type = if (attachments.isNotEmpty()) MessageType.FILE else MessageType.TEXT,
                    attachments = attachments,
                    timestamp = timestamp,
                    syncSeq = syncSeq,
                    isStreaming = isStreaming
                ).toEntity()
            }
        }
    }

    private fun MessageEntity.toMessage(): Message {
        val attachments = deserializeAttachments(attachmentsJson).ifEmpty {
            legacyAttachment(fileName, fileSize, mimeType, filePath)?.let(::listOf) ?: emptyList()
        }
        val resolvedType = when {
            parseMessageType(type) == MessageType.THINKING -> MessageType.THINKING
            attachments.isNotEmpty() -> MessageType.FILE
            else -> parseMessageType(type)
        }

        return Message(
            id = id,
            projectId = projectId,
            role = parseMessageRole(role),
            content = content,
            type = resolvedType,
            attachments = attachments,
            fileInfo = attachments.firstOrNull()?.toFileInfo()
                ?: if (fileName != null) FileInfo(fileName, fileSize ?: 0, mimeType ?: "", filePath) else null,
            streamId = streamId,
            timestamp = timestamp,
            syncSeq = syncSeq,
            isStreaming = isStreaming
        )
    }

    private fun serializeAttachments(attachments: List<MessageAttachment>): String? =
        if (attachments.isEmpty()) {
            null
        } else {
            json.encodeToString(ListSerializer(MessageAttachment.serializer()), attachments)
        }

    private fun deserializeAttachments(raw: String?): List<MessageAttachment> {
        if (raw.isNullOrBlank()) {
            return emptyList()
        }
        return runCatching {
            json.decodeFromString(ListSerializer(MessageAttachment.serializer()), raw)
        }.getOrElse { emptyList() }
    }

    private fun legacyAttachment(
        fileName: String?,
        fileSize: Long?,
        mimeType: String?,
        filePath: String?
    ): MessageAttachment? {
        val resolvedName = fileName?.trim().orEmpty()
        val resolvedPath = filePath?.trim().orEmpty()
        if (resolvedName.isBlank() && resolvedPath.isBlank()) {
            return null
        }
        val resolvedMimeType = mimeType ?: guessMimeType(resolvedName.ifBlank { resolvedPath })
        return MessageAttachment(
            id = UUID.randomUUID().toString(),
            name = resolvedName.ifBlank {
                resolvedPath.substringAfterLast('/').substringAfterLast('\\').ifBlank { "attachment" }
            },
            size = fileSize ?: 0L,
            kind = if (resolvedMimeType.startsWith("image/", ignoreCase = true) || isImageFileName(resolvedName)) {
                "image"
            } else {
                "file"
            },
            mimeType = resolvedMimeType,
            filePath = resolvedPath.ifBlank { null }
        )
    }

    private fun com.claudecode.remote.data.local.SessionEntity.toSession() = Session(
        id = id,
        name = name,
        agentId = agentId,
        projectId = projectId,
        projectPath = projectPath,
        cliProvider = cliProvider,
        cliModel = cliModel,
        isAgentOnline = isAgentOnline,
        isRunning = isRunning,
        queuedCount = queuedCount,
        currentPrompt = currentPrompt,
        queuePreview = queuePreview,
        currentStartedAt = currentStartedAt,
        createdAt = createdAt,
        lastActiveAt = lastActiveAt
    )

    private fun parseMessageRole(raw: String): MessageRole =
        enumValues<MessageRole>().firstOrNull { it.name == raw.uppercase() } ?: MessageRole.ASSISTANT

    private fun parseMessageType(raw: String?): MessageType =
        enumValues<MessageType>().firstOrNull { it.name == raw?.uppercase() } ?: MessageType.TEXT

    private fun sanitizeFileName(fileName: String): String =
        fileName.substringAfterLast('/').substringAfterLast('\\').trim()
            .replace(Regex("[<>:\"/\\\\|?*\\u0000-\\u001F]"), "_")
            .ifBlank { "attachment.bin" }

    private fun uniqueFile(directory: File, fileName: String): File {
        val extension = fileName.substringAfterLast('.', "")
        val baseName = if (extension.isNotBlank()) fileName.dropLast(extension.length + 1) else fileName
        var candidate = File(directory, fileName)
        var suffix = 1
        while (candidate.exists()) {
            val nextName = if (extension.isNotBlank()) {
                "$baseName-$suffix.$extension"
            } else {
                "$baseName-$suffix"
            }
            candidate = File(directory, nextName)
            suffix += 1
        }
        return candidate
    }

    private fun isImageMimeType(mimeType: String): Boolean =
        mimeType.startsWith("image/", ignoreCase = true)

    private fun isImageFileName(fileName: String): Boolean {
        val lowerName = fileName.lowercase()
        return lowerName.endsWith(".png")
            || lowerName.endsWith(".jpg")
            || lowerName.endsWith(".jpeg")
            || lowerName.endsWith(".gif")
            || lowerName.endsWith(".webp")
            || lowerName.endsWith(".bmp")
            || lowerName.endsWith(".svg")
            || lowerName.endsWith(".ico")
            || lowerName.endsWith(".avif")
            || lowerName.endsWith(".heic")
    }

    private fun guessMimeType(fileName: String, fallback: String = "application/octet-stream"): String {
        val lowerName = fileName.lowercase()
        return when {
            lowerName.endsWith(".png") -> "image/png"
            lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") -> "image/jpeg"
            lowerName.endsWith(".gif") -> "image/gif"
            lowerName.endsWith(".webp") -> "image/webp"
            lowerName.endsWith(".bmp") -> "image/bmp"
            lowerName.endsWith(".svg") -> "image/svg+xml"
            lowerName.endsWith(".pdf") -> "application/pdf"
            lowerName.endsWith(".txt") -> "text/plain"
            lowerName.endsWith(".md") -> "text/markdown"
            lowerName.endsWith(".json") -> "application/json"
            else -> fallback
        }
    }

    private inline fun <T> List<T>.indexOfFirstIndexed(predicate: (Int, T) -> Boolean): Int {
        forEachIndexed { index, item ->
            if (predicate(index, item)) {
                return index
            }
        }
        return -1
    }
}
