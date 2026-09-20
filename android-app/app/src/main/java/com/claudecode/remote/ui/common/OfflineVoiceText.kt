package com.claudecode.remote.ui.common

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal fun extractOfflineVoiceText(hypothesis: String, field: String = "text"): String =
    runCatching {
        val result = Json.parseToJsonElement(hypothesis) as? JsonObject
        (result?.get(field) as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim().orEmpty()
    }.getOrDefault("")
