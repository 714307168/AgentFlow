package com.claudecode.remote.ui.common

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.claudecode.remote.R
import java.util.Locale

enum class VoiceInputMode {
    Transcribe,
    Send
}

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

@Composable
fun rememberVoiceInputLauncher(
    voiceInputMode: VoiceInputMode,
    onTranscribe: (String) -> Unit,
    onSend: (String) -> Unit,
    onUnavailable: (String) -> Unit
): (String) -> Unit {
    val context = androidx.compose.ui.platform.LocalContext.current
    val modeState = rememberUpdatedState(voiceInputMode)
    val onTranscribeState = rememberUpdatedState(onTranscribe)
    val onSendState = rememberUpdatedState(onSend)
    val onUnavailableState = rememberUpdatedState(onUnavailable)
    var pendingVoicePrompt by remember { mutableStateOf<String?>(null) }
    lateinit var startVoiceRecognition: (String) -> Unit

    fun handleSpokenText(spokenText: String) {
        val normalized = spokenText.trim()
        if (normalized.isEmpty()) {
            return
        }
        if (modeState.value == VoiceInputMode.Send) {
            onSendState.value(normalized)
        } else {
            onTranscribeState.value(normalized)
        }
    }

    val offlineRecognizer = remember(context) {
        OfflineVoiceRecognizer(
            context = context.applicationContext,
            onPreparing = {
                onUnavailableState.value(context.getString(R.string.voice_input_offline_preparing))
            },
            onResult = ::handleSpokenText,
            onNoMatch = {
                onUnavailableState.value(context.getString(R.string.voice_input_no_match))
            },
            onError = {
                onUnavailableState.value(context.getString(R.string.voice_input_failed))
            }
        )
    }

    DisposableEffect(offlineRecognizer) {
        onDispose { offlineRecognizer.destroy() }
    }

    val recordAudioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        val prompt = pendingVoicePrompt
        pendingVoicePrompt = null
        if (!granted) {
            onUnavailableState.value(context.getString(R.string.voice_input_permission_required))
        } else if (prompt != null) {
            startVoiceRecognition(prompt)
        }
    }

    val systemVoiceLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val text = extractVoiceInputText(result.data)
            if (text.isBlank()) {
                onUnavailableState.value(context.getString(R.string.voice_input_no_match))
            } else {
                handleSpokenText(text)
            }
        } else {
            onUnavailableState.value(context.getString(R.string.voice_input_failed))
        }
    }

    // This indirection keeps the permission callback independent from the
    // launcher ordering while ensuring the latest Compose callbacks are used.
    startVoiceRecognition = { prompt ->
        val intent = buildVoiceInputIntent(prompt)
        if (isVoiceRecognitionActivityAvailable(context, intent)) {
            try {
                systemVoiceLauncher.launch(intent)
            } catch (_: ActivityNotFoundException) {
                offlineRecognizer.start()
            }
        } else {
            offlineRecognizer.start()
        }
    }

    return remember(context, offlineRecognizer, systemVoiceLauncher, recordAudioPermissionLauncher) {
        { prompt ->
            val hasPermission = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
            if (hasPermission) {
                startVoiceRecognition(prompt)
            } else {
                pendingVoicePrompt = prompt
                recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }
}

private fun isVoiceRecognitionActivityAvailable(context: Context, intent: Intent): Boolean =
    intent.resolveActivity(context.packageManager) != null
