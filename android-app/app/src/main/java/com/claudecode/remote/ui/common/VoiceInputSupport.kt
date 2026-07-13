package com.claudecode.remote.ui.common

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.RecognitionListener
import android.speech.SpeechRecognizer
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
    var pendingEmbeddedPrompt by remember { mutableStateOf<String?>(null) }

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

    val embeddedRecognizer = remember(context) {
        EmbeddedSpeechRecognizer(
            context = context.applicationContext,
            onResult = ::handleSpokenText,
            onNoMatch = {
                onUnavailableState.value(context.getString(R.string.voice_input_no_match))
            },
            onError = {
                onUnavailableState.value(context.getString(R.string.voice_input_failed))
            }
        )
    }

    DisposableEffect(embeddedRecognizer) {
        onDispose { embeddedRecognizer.destroy() }
    }

    fun launchEmbeddedRecognizer(prompt: String) {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            onUnavailableState.value(context.getString(R.string.voice_input_unavailable))
            return
        }
        val hasPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasPermission) {
            pendingEmbeddedPrompt = prompt
            return
        }
        embeddedRecognizer.start(prompt)
    }

    val recordAudioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        val prompt = pendingEmbeddedPrompt
        pendingEmbeddedPrompt = null
        if (granted && prompt != null) {
            embeddedRecognizer.start(prompt)
        } else if (!granted) {
            onUnavailableState.value(context.getString(R.string.voice_input_permission_required))
        }
    }

    val systemVoiceLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            handleSpokenText(extractVoiceInputText(result.data))
        }
    }

    return remember(context, systemVoiceLauncher, recordAudioPermissionLauncher) {
        { prompt ->
            val intent = buildVoiceInputIntent(prompt)
            if (isVoiceRecognitionActivityAvailable(context, intent)) {
                try {
                    systemVoiceLauncher.launch(intent)
                } catch (_: ActivityNotFoundException) {
                    launchEmbeddedRecognizer(prompt)
                }
            } else {
                launchEmbeddedRecognizer(prompt)
            }

            if (
                pendingEmbeddedPrompt != null &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
                    PackageManager.PERMISSION_GRANTED
            ) {
                recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            }
        }
    }
}

private fun isVoiceRecognitionActivityAvailable(context: Context, intent: Intent): Boolean =
    intent.resolveActivity(context.packageManager) != null

private class EmbeddedSpeechRecognizer(
    private val context: Context,
    private val onResult: (String) -> Unit,
    private val onNoMatch: () -> Unit,
    private val onError: () -> Unit
) {
    private var recognizer: SpeechRecognizer? = null

    fun start(prompt: String) {
        destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
            setRecognitionListener(
                object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) = Unit
                    override fun onBeginningOfSpeech() = Unit
                    override fun onRmsChanged(rmsdB: Float) = Unit
                    override fun onBufferReceived(buffer: ByteArray?) = Unit
                    override fun onEndOfSpeech() = Unit
                    override fun onPartialResults(partialResults: Bundle?) = Unit
                    override fun onEvent(eventType: Int, params: Bundle?) = Unit

                    override fun onError(error: Int) {
                        if (error == SpeechRecognizer.ERROR_NO_MATCH ||
                            error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
                        ) {
                            onNoMatch()
                        } else {
                            onError()
                        }
                    }

                    override fun onResults(results: Bundle?) {
                        val spokenText = results
                            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                            ?.firstOrNull()
                            ?.trim()
                            .orEmpty()
                        if (spokenText.isBlank()) {
                            onNoMatch()
                        } else {
                            onResult(spokenText)
                        }
                    }
                }
            )
            startListening(buildVoiceInputIntent(prompt))
        }
    }

    fun destroy() {
        recognizer?.destroy()
        recognizer = null
    }
}
