package com.claudecode.remote.ui.common

import android.content.Intent
import android.speech.RecognizerIntent
import java.util.Locale

fun buildVoiceInputIntent(prompt: String): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
        putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
    }

fun extractVoiceInputText(data: Intent?): String =
    data
        ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
        ?.firstOrNull()
        ?.trim()
        .orEmpty()

fun appendVoiceInputText(current: String, spoken: String): String {
    val normalized = spoken.trim()
    if (normalized.isEmpty()) {
        return current
    }
    if (current.isBlank()) {
        return normalized
    }
    return if (current.last().isWhitespace()) {
        current + normalized
    } else {
        "$current $normalized"
    }
}
