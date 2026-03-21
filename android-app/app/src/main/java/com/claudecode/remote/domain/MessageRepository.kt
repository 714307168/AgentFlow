package com.claudecode.remote.domain

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.room.withTransaction
import com.claudecode.remote.data.local.AppDatabase
import com.claudecode.remote.data.local.MessageEntity
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.FileInfo
import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.model.MessageRole
import com.claudecode.remote.data.model.MessageType
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.model.StreamBuffer
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.data.remote.WakeupRequest
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.UUID

class MessageRepository(
    private val webSocket: RelayWebSocket,
    private val relayApiProvider: () -> RelayApi,
    private val tokenStore: TokenStore,
    private val context: Context
) {
    companion object {
        private const val MAX_PROJECT_MESSAGES = 200
    }

    private val db = AppDatabase.getInstance(context)
    private val messageDao = db.messageDao()
    private val sessionDao = db.sessionDao()
    private val streamBuffers = mutableMapOf<String, StreamBuffer>()

    suspend fun requestProjectSync(projectId: String, agentId: String? = null) {
        wakeupAgent(agentId)
        val afterSeq = sessionDao.getSessionByProjectId(projectId)?.lastSyncSeq ?: 0L

        webSocket.send(
            Envelope(
                id = UUID.randomUUID().toString(),
                event = Events.SESSION_SYNC_REQUEST,
                projectId = projectId,
                payload = buildJsonObject {
                    put("after_seq", JsonPrimitive(afterSeq))
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

    suspend fun sendMessage(projectId: String, content: String, agentId: String? = null) {
        wakeupAgent(agentId)

        val runId = UUID.randomUUID().toString()
        val streamId = "$runId:assistant"
        val envelope = Envelope(
            id = runId,
            event = Events.MESSAGE_SEND,
            projectId = projectId,
            streamId = streamId,
            payload = buildJsonObject { put("content", JsonPrimitive(content)) },
            ts = System.currentTimeMillis()
        )
        // Optimistically add user message to local state
        val userMessage = Message(
            id = envelope.id,
            projectId = projectId,
            role = MessageRole.USER,
            content = content,
            type = MessageType.TEXT,
            timestamp = envelope.ts
        )
        addMessage(userMessage)
        webSocket.send(envelope)
    }

    suspend fun sendFile(projectId: String, fileUri: Uri, agentId: String? = null) = withContext(Dispatchers.IO) {
        wakeupAgent(agentId)

        val fileId = UUID.randomUUID().toString()
        val contentResolver = context.contentResolver

        // Get file info
        val fileName = contentResolver.query(fileUri, null, null, null, null)?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            cursor.moveToFirst()
            cursor.getString(nameIndex)
        } ?: "unknown"

        val fileSize = contentResolver.query(fileUri, null, null, null, null)?.use { cursor ->
            val sizeIndex = cursor.getColumnIndex(android.provider.OpenableColumns.SIZE)
            cursor.moveToFirst()
            cursor.getLong(sizeIndex)
        } ?: 0L

        val mimeType = contentResolver.getType(fileUri) ?: "application/octet-stream"

        // Send file.upload envelope
        val uploadEnvelope = Envelope(
            id = fileId,
            event = Events.FILE_UPLOAD,
            projectId = projectId,
            payload = buildJsonObject {
                put("file_name", JsonPrimitive(fileName))
                put("file_size", JsonPrimitive(fileSize))
                put("mime_type", JsonPrimitive(mimeType))
            },
            ts = System.currentTimeMillis()
        )

        // Add file message to UI
        val fileMessage = Message(
            id = fileId,
            projectId = projectId,
            role = MessageRole.USER,
            content = fileName,
            type = MessageType.FILE,
            fileInfo = FileInfo(fileName, fileSize, mimeType),
            timestamp = uploadEnvelope.ts
        )
        addMessage(fileMessage)
        webSocket.send(uploadEnvelope)

        // Send file chunks
        val chunkSize = 64 * 1024 // 64KB chunks
        contentResolver.openInputStream(fileUri)?.use { inputStream ->
            val buffer = ByteArray(chunkSize)
            var seq = 0L
            var bytesRead: Int

            while (inputStream.read(buffer).also { bytesRead = it } != -1) {
                val currentSeq = seq++
                val chunk = Base64.encodeToString(buffer, 0, bytesRead, Base64.NO_WRAP)
                val chunkEnvelope = Envelope(
                    id = UUID.randomUUID().toString(),
                    event = Events.FILE_CHUNK,
                    projectId = projectId,
                    streamId = fileId,
                    seq = currentSeq,
                    payload = buildJsonObject {
                        put("file_id", JsonPrimitive(fileId))
                        put("chunk", JsonPrimitive(chunk))
                        put("seq", JsonPrimitive(currentSeq))
                    },
                    ts = System.currentTimeMillis()
                )
                webSocket.send(chunkEnvelope)
            }
        }

        // Send file.done
        val doneEnvelope = Envelope(
            id = UUID.randomUUID().toString(),
            event = Events.FILE_DONE,
            projectId = projectId,
            streamId = fileId,
            payload = buildJsonObject {
                put("file_id", JsonPrimitive(fileId))
                put("file_name", JsonPrimitive(fileName))
            },
            ts = System.currentTimeMillis()
        )
        webSocket.send(doneEnvelope)
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

                // Upsert streaming message
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
                // Reset running state — SESSION_SYNC may not arrive if connection drops
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
                        content = existingMessage?.content?.ifBlank { "[Error receiving response]" } ?: "[Error receiving response]",
                        isStreaming = false,
                        timestamp = existingMessage?.timestamp ?: envelope.ts
                    )
                }
                // Reset running state on error too
                sessionDao.resetRunningState(projectId)
            }
            Events.SESSION_SYNC -> {
                val payloadObj = envelope.payload?.jsonObject ?: return
                val provider = payloadObj["provider"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrBlank() } ?: "claude"
                val model = payloadObj["model"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrBlank() }
                val isRunning = payloadObj["isRunning"]?.jsonPrimitive?.booleanOrNull ?: false
                val queuedCount = payloadObj["queuedCount"]?.jsonPrimitive?.intOrNull ?: 0
                val currentPrompt = payloadObj["currentPrompt"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrBlank() }
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
                    val items = syncObj["items"]?.jsonArray ?: JsonArray(emptyList())
                    CrashLogger.logInfo(
                        "MessageRepository",
                        "Received session.sync v2 for projectId=$projectId items=${items.size} latestSeq=$latestSeq running=$isRunning queued=$queuedCount"
                    )
                    applyProjectSyncDelta(projectId, items, latestSeq, envelope.ts)
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
        fallbackTimestamp: Long
    ) {
        db.withTransaction {
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
                messageDao.insertMessage(entity)
            }

            messageDao.pruneProjectMessages(projectId, MAX_PROJECT_MESSAGES)
            sessionDao.updateLastSyncSeq(projectId, latestSeq)
        }
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
            messageDao.insertMessages(messages)
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
        val message = Message(
            id = streamId,
            projectId = projectId,
            role = MessageRole.ASSISTANT,
            content = content,
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

        val token = tokenStore.getToken()
        if (token.isNullOrBlank()) {
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

    private fun Message.toEntity() = MessageEntity(
        id = id,
        projectId = projectId,
        role = role.name,
        content = content,
        type = type.name,
        fileName = fileInfo?.fileName,
        fileSize = fileInfo?.fileSize,
        mimeType = fileInfo?.mimeType,
        filePath = fileInfo?.filePath,
        streamId = streamId,
        timestamp = timestamp,
        syncSeq = syncSeq,
        isStreaming = isStreaming
    )

    private fun parseDesktopMessage(
        projectId: String,
        messageObj: JsonObject,
        fallbackTimestamp: Long,
        syncSeq: Long
    ): MessageEntity? {
        val id = messageObj["id"]?.jsonPrimitive?.content ?: return null
        val roleValue = messageObj["role"]?.jsonPrimitive?.content?.lowercase() ?: "assistant"
        val attachments = parseDesktopAttachments(messageObj["attachments"]).ifEmpty {
            parseDesktopFileInfo(messageObj)?.let(::listOf) ?: emptyList()
        }
        val content = messageObj["content"]?.jsonPrimitive?.contentOrNull
            ?: attachments.firstOrNull()?.fileName
            ?: ""
        val createdAt = messageObj["createdAt"]?.jsonPrimitive?.longOrNull
            ?: messageObj["updatedAt"]?.jsonPrimitive?.longOrNull
            ?: fallbackTimestamp
        val status = messageObj["status"]?.jsonPrimitive?.content ?: "done"
        val desktopFile = attachments.firstOrNull()
        val messageType = when {
            parseMessageType(messageObj["type"]?.jsonPrimitive?.contentOrNull) == MessageType.FILE -> MessageType.FILE
            desktopFile != null -> MessageType.FILE
            else -> parseMessageType(messageObj["type"]?.jsonPrimitive?.contentOrNull)
        }

        return Message(
            id = id,
            projectId = projectId,
            role = if (roleValue == "user") MessageRole.USER else MessageRole.ASSISTANT,
            content = if (roleValue == "error") "[Error] $content" else content,
            type = messageType,
            fileInfo = desktopFile,
            timestamp = createdAt,
            syncSeq = syncSeq,
            isStreaming = status == "streaming"
        ).toEntity()
    }

    private fun parseDesktopFileInfo(messageObj: JsonObject): FileInfo? {
        val fileName = messageObj["fileName"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        val filePath = messageObj["filePath"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
        if (fileName.isBlank() && filePath.isBlank()) {
            return null
        }

        return FileInfo(
            fileName = fileName.ifBlank {
                filePath.substringAfterLast('/').substringAfterLast('\\').ifBlank { "attachment" }
            },
            fileSize = messageObj["fileSize"]?.jsonPrimitive?.longOrNull ?: 0L,
            mimeType = messageObj["mimeType"]?.jsonPrimitive?.contentOrNull ?: "application/octet-stream",
            filePath = filePath.ifBlank { null }
        )
    }

    private fun parseDesktopAttachments(rawAttachments: kotlinx.serialization.json.JsonElement?): List<FileInfo> {
        val attachmentArray = runCatching { rawAttachments?.jsonArray }.getOrNull() ?: return emptyList()
        return attachmentArray.mapNotNull { item ->
            val attachmentObj = runCatching { item.jsonObject }.getOrNull() ?: return@mapNotNull null
            val filePath = attachmentObj["path"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val fileName = attachmentObj["name"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            if (filePath.isBlank() && fileName.isBlank()) {
                return@mapNotNull null
            }

            val kind = attachmentObj["kind"]?.jsonPrimitive?.contentOrNull?.lowercase().orEmpty()
            val mimeType = when {
                kind == "image" -> "image/*"
                else -> attachmentObj["mimeType"]?.jsonPrimitive?.contentOrNull ?: "application/octet-stream"
            }
            val fileSize = attachmentObj["size"]?.jsonPrimitive?.longOrNull ?: 0L

            FileInfo(
                fileName = fileName.ifBlank {
                    filePath.substringAfterLast('/').substringAfterLast('\\').ifBlank { "attachment" }
                },
                fileSize = fileSize,
                mimeType = mimeType,
                filePath = filePath.ifBlank { null }
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
                timestamp = timestamp,
                syncSeq = syncSeq,
                isStreaming = isStreaming
            )
            else -> {
                val attachments = parseDesktopAttachments(itemObj["attachments"]).ifEmpty {
                    parseDesktopFileInfo(itemObj)?.let(::listOf) ?: emptyList()
                }
                val fileInfo = attachments.firstOrNull()
                val roleValue = itemObj["role"]?.jsonPrimitive?.contentOrNull?.lowercase() ?: "assistant"
                val content = itemObj["content"]?.jsonPrimitive?.contentOrNull
                    ?: fileInfo?.fileName
                    ?: ""
                val messageType = when {
                    fileInfo != null -> MessageType.FILE
                    else -> MessageType.TEXT
                }
                Message(
                    id = id,
                    projectId = projectId,
                    role = when (roleValue) {
                        "user" -> MessageRole.USER
                        else -> MessageRole.ASSISTANT
                    },
                    content = if (roleValue == "error") "[Error] $content" else content,
                    type = messageType,
                    fileInfo = fileInfo,
                    timestamp = timestamp,
                    syncSeq = syncSeq,
                    isStreaming = isStreaming
                ).toEntity()
            }
        }
    }

    private fun MessageEntity.toMessage() = Message(
        id = id,
        projectId = projectId,
        role = parseMessageRole(role),
        content = content,
        type = parseMessageType(type),
        fileInfo = if (fileName != null) FileInfo(fileName, fileSize ?: 0, mimeType ?: "", filePath) else null,
        streamId = streamId,
        timestamp = timestamp,
        syncSeq = syncSeq,
        isStreaming = isStreaming
    )

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
}
