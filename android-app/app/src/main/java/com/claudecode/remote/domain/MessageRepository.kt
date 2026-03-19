package com.claudecode.remote.domain

import android.content.Context
import android.net.Uri
import android.util.Base64
import com.claudecode.remote.data.local.AppDatabase
import com.claudecode.remote.data.local.MessageEntity
import com.claudecode.remote.data.local.TokenStore
import com.claudecode.remote.data.model.Envelope
import com.claudecode.remote.data.model.Events
import com.claudecode.remote.data.model.FileInfo
import com.claudecode.remote.data.model.Message
import com.claudecode.remote.data.model.MessageRole
import com.claudecode.remote.data.model.Session
import com.claudecode.remote.data.model.MessageType
import com.claudecode.remote.data.model.StreamBuffer
import com.claudecode.remote.data.remote.RelayApi
import com.claudecode.remote.data.remote.RelayWebSocket
import com.claudecode.remote.data.remote.WakeupRequest
import com.claudecode.remote.util.CrashLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.util.UUID

class MessageRepository(
    private val webSocket: RelayWebSocket,
    private val relayApi: RelayApi,
    private val tokenStore: TokenStore,
    private val context: Context
) {
    private val db = AppDatabase.getInstance(context)
    private val messageDao = db.messageDao()
    private val sessionDao = db.sessionDao()
    private val streamBuffers = mutableMapOf<String, StreamBuffer>()

    suspend fun requestProjectSync(projectId: String, agentId: String? = null) {
        wakeupAgent(agentId)

        webSocket.send(
            Envelope(
                id = UUID.randomUUID().toString(),
                event = Events.SESSION_SYNC_REQUEST,
                projectId = projectId,
                ts = System.currentTimeMillis()
            )
        )
    }

    suspend fun sendMessage(projectId: String, content: String, agentId: String? = null) {
        wakeupAgent(agentId)

        val envelope = Envelope(
            id = UUID.randomUUID().toString(),
            event = Events.MESSAGE_SEND,
            projectId = projectId,
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

                val buffer = streamBuffers.getOrPut(streamId) { StreamBuffer(streamId, startedAt = envelope.ts) }
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
                }
            }
            Events.MESSAGE_ERROR -> {
                val streamId = envelope.streamId
                if (streamId != null) {
                    streamBuffers.remove(streamId)
                    upsertStreamingMessage(projectId, streamId, "[Error receiving response]", isStreaming = false, timestamp = envelope.ts)
                }
            }
            Events.SESSION_SYNC -> {
                val payloadObj = envelope.payload?.jsonObject ?: return
                val provider = payloadObj["provider"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrBlank() } ?: "claude"
                val model = payloadObj["model"]?.jsonPrimitive?.contentOrNull?.trim().takeUnless { it.isNullOrBlank() }
                sessionDao.updateSessionRuntime(projectId, provider, model, envelope.ts)
                val messages = payloadObj["messages"]?.jsonArray ?: return
                replaceProjectMessagesFromDesktop(projectId, messages, envelope.ts)
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

    private suspend fun replaceProjectMessagesFromDesktop(
        projectId: String,
        rawMessages: kotlinx.serialization.json.JsonArray,
        fallbackTimestamp: Long
    ) {
        val messages = rawMessages.mapNotNull { item ->
            val messageObj = item.jsonObject
            val id = messageObj["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
            val roleValue = messageObj["role"]?.jsonPrimitive?.content?.lowercase() ?: "assistant"
            val content = messageObj["content"]?.jsonPrimitive?.content ?: ""
            val createdAt = messageObj["createdAt"]?.jsonPrimitive?.longOrNull
                ?: messageObj["updatedAt"]?.jsonPrimitive?.longOrNull
                ?: fallbackTimestamp
            val status = messageObj["status"]?.jsonPrimitive?.content ?: "done"

            Message(
                id = id,
                projectId = projectId,
                role = if (roleValue == "user") MessageRole.USER else MessageRole.ASSISTANT,
                content = if (roleValue == "error") "[Error] $content" else content,
                type = MessageType.TEXT,
                timestamp = createdAt,
                isStreaming = status == "streaming"
            ).toEntity()
        }

        messageDao.deleteMessagesByProject(projectId)
        if (messages.isNotEmpty()) {
            messageDao.insertMessages(messages)
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
            relayApi.wakeupAgent(
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
        isStreaming = isStreaming
    )

    private fun MessageEntity.toMessage() = Message(
        id = id,
        projectId = projectId,
        role = MessageRole.valueOf(role),
        content = content,
        type = MessageType.valueOf(type),
        fileInfo = if (fileName != null) FileInfo(fileName, fileSize ?: 0, mimeType ?: "", filePath) else null,
        streamId = streamId,
        timestamp = timestamp,
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
        createdAt = createdAt,
        lastActiveAt = lastActiveAt
    )
}
