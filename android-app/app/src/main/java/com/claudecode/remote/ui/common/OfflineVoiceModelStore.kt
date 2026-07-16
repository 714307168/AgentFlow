package com.claudecode.remote.ui.common

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

private const val OFFLINE_VOICE_MODEL_NAME = "vosk-model-small-cn-0.22"
private const val OFFLINE_VOICE_MODEL_URL =
    "https://huggingface.co/rhasspy/vosk-models/resolve/main/zh/vosk-model-small-cn-0.22.zip"
private const val OFFLINE_VOICE_MODEL_SHA256 =
    "3af8b0e7e0f835ae9d414ce5df580237a3cfb08d586c9fbbb0f7ff29ad5b14ba"
private const val MAX_MODEL_ARCHIVE_BYTES = 80L * 1024 * 1024
private const val MAX_MODEL_UNPACKED_BYTES = 160L * 1024 * 1024

internal class OfflineVoiceModelStore(
    private val context: Context,
    private val client: OkHttpClient = defaultOfflineVoiceHttpClient,
    private val modelUrl: String = OFFLINE_VOICE_MODEL_URL
) {
    fun getInstalledModelDirectory(): File? = modelDirectory.takeIf(::isUsableModelDirectory)

    @Throws(IOException::class)
    fun installIfNeeded(onDownloadStarted: () -> Unit): File {
        getInstalledModelDirectory()?.let { return it }

        synchronized(installLock) {
            getInstalledModelDirectory()?.let { return it }
            onDownloadStarted()
            installDirectory.deleteRecursively()
            installDirectory.mkdirsOrThrow()
            val archive = File(installDirectory, "$OFFLINE_VOICE_MODEL_NAME.zip")
            val stagingDirectory = File(installDirectory, "$OFFLINE_VOICE_MODEL_NAME.staging")
            try {
                downloadArchive(archive)
                unpackArchive(archive, stagingDirectory)
                val unpackedModelDirectory = File(stagingDirectory, OFFLINE_VOICE_MODEL_NAME)
                requireUsableModelDirectory(unpackedModelDirectory)
                modelDirectory.deleteRecursively()
                if (!unpackedModelDirectory.renameTo(modelDirectory)) {
                    throw IOException("Unable to activate the offline voice model.")
                }
                return modelDirectory
            } finally {
                archive.delete()
                stagingDirectory.deleteRecursively()
            }
        }
    }

    private fun downloadArchive(destination: File) {
        val request = Request.Builder().url(modelUrl).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Offline voice model download failed (HTTP ${response.code}).")
            }
            val body = response.body ?: throw IOException("Offline voice model download was empty.")
            val contentLength = body.contentLength()
            if (contentLength > MAX_MODEL_ARCHIVE_BYTES) {
                throw IOException("Offline voice model download is larger than expected.")
            }
            body.byteStream().use { input ->
                FileOutputStream(destination).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    val digest = MessageDigest.getInstance("SHA-256")
                    var totalBytes = 0L
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        totalBytes += read
                        if (totalBytes > MAX_MODEL_ARCHIVE_BYTES) {
                            throw IOException("Offline voice model download is larger than expected.")
                        }
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                    }
                    if (digest.digest().toHexString() != OFFLINE_VOICE_MODEL_SHA256) {
                        throw IOException("Offline voice model download failed its integrity check.")
                    }
                }
            }
        }
    }

    private fun unpackArchive(archive: File, stagingDirectory: File) {
        stagingDirectory.mkdirsOrThrow()
        var unpackedBytes = 0L
        ZipInputStream(archive.inputStream().buffered()).use { input ->
            while (true) {
                val entry = input.nextEntry ?: break
                val destination = resolveSafeZipDestination(stagingDirectory, entry.name)
                if (entry.isDirectory) {
                    destination.mkdirsOrThrow()
                } else {
                    destination.parentFile?.mkdirsOrThrow()
                    FileOutputStream(destination).use { output ->
                        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            unpackedBytes += read
                            if (unpackedBytes > MAX_MODEL_UNPACKED_BYTES) {
                                throw IOException("Offline voice model is larger than expected.")
                            }
                            output.write(buffer, 0, read)
                        }
                    }
                }
                input.closeEntry()
            }
        }
    }

    private fun requireUsableModelDirectory(directory: File) {
        if (!isUsableModelDirectory(directory)) {
            throw IOException("Offline voice model files are incomplete.")
        }
    }

    private val installDirectory: File
        get() = File(context.filesDir, "offline-voice")

    private val modelDirectory: File
        get() = File(installDirectory, OFFLINE_VOICE_MODEL_NAME)

    companion object {
        private val installLock = Any()
        private val defaultOfflineVoiceHttpClient = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .build()
    }
}

internal fun resolveSafeZipDestination(root: File, entryName: String): File {
    val target = File(root, entryName)
    val rootPath = root.canonicalPath + File.separator
    if (!target.canonicalPath.startsWith(rootPath)) {
        throw IOException("Offline voice model archive contains an invalid path.")
    }
    return target
}

internal fun isUsableModelDirectory(directory: File): Boolean =
    directory.isDirectory &&
        File(directory, "am").isDirectory &&
        File(directory, "conf").isDirectory &&
        File(directory, "graph").isDirectory

private fun File.mkdirsOrThrow() {
    if (!exists() && !mkdirs()) {
        throw IOException("Unable to create offline voice model storage.")
    }
}

private fun ByteArray.toHexString(): String = joinToString("") { byte -> "%02x".format(byte) }
