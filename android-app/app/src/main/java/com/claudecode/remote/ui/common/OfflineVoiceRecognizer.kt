package com.claudecode.remote.ui.common

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

internal class OfflineVoiceRecognizer(
    context: Context,
    private val onPreparing: () -> Unit,
    private val onResult: (String) -> Unit,
    private val onNoMatch: () -> Unit,
    private val onError: () -> Unit,
    private val modelStore: OfflineVoiceModelStore = OfflineVoiceModelStore(context)
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()
    private var speechService: SpeechService? = null
    private var recognizer: Recognizer? = null
    private var model: Model? = null
    private var destroyed = false
    private var starting = false

    fun start() {
        synchronized(this) {
            if (destroyed || starting || speechService != null) return
            starting = true
        }
        worker.execute {
            try {
                val modelDirectory = modelStore.installIfNeeded {
                    mainHandler.post(onPreparing)
                }
                if (destroyed) return@execute
                val nextModel = Model(modelDirectory.absolutePath)
                val nextRecognizer = Recognizer(nextModel, SAMPLE_RATE_HZ)
                val nextSpeechService = SpeechService(nextRecognizer, SAMPLE_RATE_HZ)
                synchronized(this) {
                    if (destroyed) {
                        nextSpeechService.shutdown()
                        nextRecognizer.close()
                        nextModel.close()
                        return@execute
                    }
                    model = nextModel
                    recognizer = nextRecognizer
                    speechService = nextSpeechService
                }
                if (!nextSpeechService.startListening(listener, LISTEN_TIMEOUT_MILLIS)) {
                    finish()
                    mainHandler.post(onError)
                }
            } catch (_: Exception) {
                finish()
                mainHandler.post(onError)
            } finally {
                synchronized(this) { starting = false }
            }
        }
    }

    fun destroy() {
        synchronized(this) { destroyed = true }
        finish()
        worker.shutdownNow()
    }

    private val listener = object : RecognitionListener {
        override fun onPartialResult(hypothesis: String) = Unit

        override fun onResult(hypothesis: String) {
            deliverResult(hypothesis)
        }

        override fun onFinalResult(hypothesis: String) {
            deliverResult(hypothesis)
        }

        override fun onError(exception: Exception) {
            finish()
            onError()
        }

        override fun onTimeout() {
            finish()
            onNoMatch()
        }
    }

    private fun deliverResult(hypothesis: String) {
        val text = extractOfflineVoiceText(hypothesis)
        finish()
        if (text.isBlank()) onNoMatch() else onResult(text)
    }

    private fun finish() {
        val currentService: SpeechService?
        val currentRecognizer: Recognizer?
        val currentModel: Model?
        synchronized(this) {
            currentService = speechService
            currentRecognizer = recognizer
            currentModel = model
            speechService = null
            recognizer = null
            model = null
        }
        currentService?.cancel()
        currentService?.shutdown()
        currentRecognizer?.close()
        currentModel?.close()
    }

    companion object {
        private const val SAMPLE_RATE_HZ = 16_000f
        private const val LISTEN_TIMEOUT_MILLIS = 15_000
    }
}

internal fun extractOfflineVoiceText(hypothesis: String): String =
    VOSK_TEXT_PATTERN.find(hypothesis)?.groupValues?.getOrNull(1)?.trim().orEmpty()

private val VOSK_TEXT_PATTERN = Regex("\\\"text\\\"\\s*:\\s*\\\"([^\\\"]*)\\\"")
