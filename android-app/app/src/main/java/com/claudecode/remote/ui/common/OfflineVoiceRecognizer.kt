package com.claudecode.remote.ui.common

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.claudecode.remote.BuildConfig
import com.claudecode.remote.util.CrashLogger
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.IOException
import java.util.concurrent.Executors

internal enum class OfflineVoiceError { Preparation, Microphone }

internal class OfflineVoiceRecognizer(
    context: Context,
    private val onPreparing: () -> Unit,
    private val onListening: () -> Unit,
    private val onPartial: (String) -> Unit,
    private val onResult: (String) -> Unit,
    private val onNoMatch: () -> Unit,
    private val onError: (OfflineVoiceError) -> Unit,
    private val modelStore: OfflineVoiceModelStore = OfflineVoiceModelStore(
        context.filesDir,
        { context.assets.open(BuildConfig.OFFLINE_VOICE_MODEL_NAME + ".zip") }
    )
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    // Native objects are created and released on one worker, including cancellation.
    private val worker = Executors.newSingleThreadExecutor()
    private var speechService: SpeechService? = null
    private var recognizer: Recognizer? = null
    private var model: Model? = null
    @Volatile private var generation = 0L
    @Volatile private var destroyed = false
    private var active = false

    fun start() {
        if (destroyed || active) return
        active = true
        val id = ++generation
        onPreparing()
        worker.execute {
            var failure = OfflineVoiceError.Preparation
            try {
                val directory = modelStore.installIfNeeded { !isCurrent(id) }
                if (!isCurrent(id)) return@execute
                model = Model(directory.absolutePath)
                recognizer = Recognizer(model, SAMPLE_RATE_HZ)
                failure = OfflineVoiceError.Microphone
                speechService = SpeechService(recognizer, SAMPLE_RATE_HZ)
                if (!isCurrent(id)) {
                    release()
                    return@execute
                }
                if (speechService?.startListening(listener(id), LISTEN_TIMEOUT_MILLIS) != true) {
                    throw IOException("Unable to start the microphone.")
                }
                postIfCurrent(id, onListening)
            } catch (error: Exception) {
                handleFailure(id, failure, error)
            } catch (error: LinkageError) {
                handleFailure(id, failure, error)
            }
        }
    }

    fun stop() {
        if (!active || destroyed) return
        val id = generation
        worker.execute {
            if (isCurrent(id)) speechService?.stop()
        }
    }

    fun cancel() {
        if (destroyed || !active) return
        active = false
        generation++
        worker.execute { release() }
    }

    fun destroy() {
        if (destroyed) return
        cancel()
        destroyed = true
        // Let queued cleanup finish. Interrupting a native read/join can close a live recognizer.
        worker.shutdown()
    }

    private fun listener(id: Long) = object : RecognitionListener {
        private var partial = ""

        override fun onPartialResult(hypothesis: String) {
            if (!isCurrent(id)) return
            partial = extractOfflineVoiceText(hypothesis, "partial")
            onPartial(partial)
        }

        override fun onResult(hypothesis: String) {
            val text = extractOfflineVoiceText(hypothesis)
            // Vosk can emit an empty segment during initial silence; keep listening.
            if (text.isNotBlank()) deliver(text)
        }

        override fun onFinalResult(hypothesis: String) {
            deliver(extractOfflineVoiceText(hypothesis).ifBlank { partial })
        }

        override fun onError(exception: Exception) {
            if (!isCurrent(id)) return
            CrashLogger.logError("OfflineVoice", "Microphone recognition failed", exception)
            complete(id) { this@OfflineVoiceRecognizer.onError(OfflineVoiceError.Microphone) }
        }

        override fun onTimeout() = deliver(partial)

        private fun deliver(text: String) {
            complete(id) { if (text.isBlank()) onNoMatch() else this@OfflineVoiceRecognizer.onResult(text) }
        }
    }

    private fun handleFailure(id: Long, failure: OfflineVoiceError, error: Throwable) {
        release()
        if (!isCurrent(id)) return
        CrashLogger.logError("OfflineVoice", "Voice input failed during $failure", error)
        postIfCurrent(id) { complete(id) { onError(failure) } }
    }

    private fun complete(id: Long, callback: () -> Unit) {
        if (!isCurrent(id)) return
        active = false
        generation++
        worker.execute { release() }
        callback()
    }

    private fun isCurrent(id: Long) = !destroyed && generation == id

    private fun postIfCurrent(id: Long, callback: () -> Unit) {
        mainHandler.post { if (isCurrent(id)) callback() }
    }

    private fun release() {
        speechService?.cancel()
        speechService?.shutdown()
        speechService = null
        recognizer?.close()
        recognizer = null
        model?.close()
        model = null
    }

    companion object {
        private const val SAMPLE_RATE_HZ = 16_000f
        private const val LISTEN_TIMEOUT_MILLIS = 30_000
    }
}
