package com.claudecode.remote.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class Envelope(
    val id: String,
    val event: String,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("stream_id") val streamId: String? = null,
    val seq: Long? = null,
    val payload: JsonElement? = null,
    val ts: Long
)

object Events {
    const val AUTH_LOGIN = "auth.login"
    const val AUTH_RESUME = "auth.resume"
    const val AUTH_OK = "auth.ok"
    const val AUTH_ERROR = "auth.error"
    const val PROJECT_BIND = "project.bind"
    const val PROJECT_BOUND = "project.bound"
    const val MESSAGE_SEND = "message.send"
    const val MESSAGE_CHUNK = "message.chunk"
    const val MESSAGE_DONE = "message.done"
    const val MESSAGE_ERROR = "message.error"
    const val AGENT_STATUS = "agent.status"
    const val E2E_OFFER = "e2e.offer"
    const val E2E_ANSWER = "e2e.answer"
    const val FILE_UPLOAD = "file.upload"
    const val FILE_CHUNK = "file.chunk"
    const val FILE_DONE = "file.done"
    const val FILE_ERROR = "file.error"
    const val PING = "ping"
    const val PONG = "pong"
}
