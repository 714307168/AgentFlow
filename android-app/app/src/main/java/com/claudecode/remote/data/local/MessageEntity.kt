package com.claudecode.remote.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.claudecode.remote.data.model.MessageRole
import com.claudecode.remote.data.model.MessageType

@Entity(tableName = "messages")
data class MessageEntity(
    @PrimaryKey val id: String,
    val projectId: String,
    val role: String, // USER or ASSISTANT
    val content: String,
    val type: String, // TEXT or FILE
    val fileName: String? = null,
    val fileSize: Long? = null,
    val mimeType: String? = null,
    val filePath: String? = null,
    val streamId: String? = null,
    val timestamp: Long,
    val isStreaming: Boolean = false
)
