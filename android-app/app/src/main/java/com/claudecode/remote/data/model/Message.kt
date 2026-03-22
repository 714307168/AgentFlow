package com.claudecode.remote.data.model

import kotlinx.serialization.Serializable

enum class MessageRole { USER, ASSISTANT }

enum class MessageType { TEXT, FILE, THINKING }

@Serializable
data class MessageAttachment(
    val id: String,
    val name: String,
    val size: Long,
    val kind: String = "file",
    val mimeType: String = "application/octet-stream",
    val filePath: String? = null,
    val localUri: String? = null,
    val previewDataUrl: String? = null
) {
    val isImage: Boolean
        get() = kind.equals("image", ignoreCase = true) || mimeType.startsWith("image/", ignoreCase = true)
}

@Serializable
data class Message(
    val id: String,
    val projectId: String,
    val role: MessageRole,
    val content: String,
    val type: MessageType = MessageType.TEXT,
    val attachments: List<MessageAttachment> = emptyList(),
    val fileInfo: FileInfo? = attachments.firstOrNull()?.toFileInfo(),
    val streamId: String? = null,
    val timestamp: Long,
    val syncSeq: Long = 0L,
    val isStreaming: Boolean = false
)

@Serializable
data class FileInfo(
    val fileName: String,
    val fileSize: Long,
    val mimeType: String,
    val filePath: String? = null
)

fun MessageAttachment.toFileInfo(): FileInfo = FileInfo(
    fileName = name,
    fileSize = size,
    mimeType = mimeType,
    filePath = filePath ?: localUri
)

data class StreamBuffer(
    val streamId: String,
    val startedAt: Long = System.currentTimeMillis(),
    var baseContent: String = "",
    val chunks: MutableMap<Long, String> = mutableMapOf(),
    var isDone: Boolean = false
) {
    fun assembledContent(): String = baseContent + chunks.toSortedMap().values.joinToString("")
}
