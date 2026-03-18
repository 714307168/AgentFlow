package com.claudecode.remote.data.model

import kotlinx.serialization.Serializable

enum class MessageRole { USER, ASSISTANT }

enum class MessageType { TEXT, FILE }

@Serializable
data class Message(
    val id: String,
    val projectId: String,
    val role: MessageRole,
    val content: String,
    val type: MessageType = MessageType.TEXT,
    val fileInfo: FileInfo? = null,
    val streamId: String? = null,
    val timestamp: Long,
    val isStreaming: Boolean = false
)

@Serializable
data class FileInfo(
    val fileName: String,
    val fileSize: Long,
    val mimeType: String,
    val filePath: String? = null
)

data class StreamBuffer(
    val streamId: String,
    val chunks: MutableList<Pair<Long, String>> = mutableListOf(),
    var isDone: Boolean = false
) {
    fun assembledContent(): String = chunks.sortedBy { it.first }.joinToString("") { it.second }
}
