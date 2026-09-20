package com.claudecode.remote.ui.common

import com.claudecode.remote.BuildConfig
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.security.MessageDigest
import java.util.zip.ZipInputStream

private const val MAX_MODEL_ARCHIVE_BYTES = 80L * 1024 * 1024
private const val MAX_MODEL_UNPACKED_BYTES = 160L * 1024 * 1024

internal class OfflineVoiceModelStore(
    private val filesDirectory: File,
    private val openBundledArchive: () -> InputStream,
    private val expectedSha256: String = BuildConfig.OFFLINE_VOICE_MODEL_SHA256
) {
    fun getInstalledModelDirectory(): File? = modelDirectory.takeIf {
        isUsableModelDirectory(it) &&
            File(it, ".installed").takeIf(File::isFile)?.readText() == expectedSha256
    }

    @Throws(IOException::class)
    fun installIfNeeded(isCancelled: () -> Boolean = { false }): File = synchronized(installLock) {
        checkCancelled(isCancelled)
        getInstalledModelDirectory()?.let { return@synchronized it }
        installDirectory.mkdirsOrThrow()
        val archive = File(installDirectory, "model.zip")
        val staging = File(installDirectory, "staging")
        staging.deleteRecursively()
        try {
            copyBundledArchive(archive, isCancelled)
            unpackArchive(archive, staging, isCancelled)
            val unpacked = File(staging, BuildConfig.OFFLINE_VOICE_MODEL_NAME)
            if (!isUsableModelDirectory(unpacked)) throw IOException("Offline voice model files are incomplete.")
            checkCancelled(isCancelled)
            File(unpacked, ".installed").writeText(expectedSha256)
            modelDirectory.deleteRecursively()
            if (!unpacked.renameTo(modelDirectory)) throw IOException("Unable to activate the offline voice model.")
            modelDirectory
        } finally {
            archive.delete()
            staging.deleteRecursively()
        }
    }

    private fun copyBundledArchive(destination: File, isCancelled: () -> Boolean) {
        val digest = MessageDigest.getInstance("SHA-256")
        openBundledArchive().use { input ->
            destination.outputStream().use { output ->
                val buffer = ByteArray(64 * 1024)
                var total = 0L
                while (true) {
                    checkCancelled(isCancelled)
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > MAX_MODEL_ARCHIVE_BYTES) throw IOException("Offline voice archive is too large.")
                    output.write(buffer, 0, count)
                    digest.update(buffer, 0, count)
                }
            }
        }
        if (digest.digest().joinToString("") { "%02x".format(it) } != expectedSha256) {
            throw IOException("Bundled voice model failed its integrity check.")
        }
    }

    private fun unpackArchive(archive: File, staging: File, isCancelled: () -> Boolean) {
        staging.mkdirsOrThrow()
        var unpackedBytes = 0L
        ZipInputStream(archive.inputStream().buffered()).use { input ->
            while (true) {
                checkCancelled(isCancelled)
                val entry = input.nextEntry ?: break
                val destination = resolveSafeZipDestination(staging, entry.name)
                if (entry.isDirectory) {
                    destination.mkdirsOrThrow()
                } else {
                    destination.parentFile?.mkdirsOrThrow()
                    destination.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            checkCancelled(isCancelled)
                            val count = input.read(buffer)
                            if (count < 0) break
                            unpackedBytes += count
                            if (unpackedBytes > MAX_MODEL_UNPACKED_BYTES) throw IOException("Offline voice model is too large.")
                            output.write(buffer, 0, count)
                        }
                    }
                }
                input.closeEntry()
            }
        }
    }

    private val installDirectory get() = File(filesDirectory, "offline-voice")
    private val modelDirectory get() = File(installDirectory, BuildConfig.OFFLINE_VOICE_MODEL_NAME)

    companion object {
        private val installLock = Any()
    }
}

internal fun resolveSafeZipDestination(root: File, entryName: String): File {
    val target = File(root, entryName)
    if (!target.canonicalPath.startsWith(root.canonicalPath + File.separator)) {
        throw IOException("Offline voice model archive contains an invalid path.")
    }
    return target
}

internal fun isUsableModelDirectory(directory: File): Boolean =
    listOf(
        "am/final.mdl", "conf/mfcc.conf", "conf/model.conf", "graph/HCLr.fst", "graph/Gr.fst",
        "graph/disambig_tid.int", "graph/phones/word_boundary.int",
        "ivector/final.ie", "ivector/final.mat", "ivector/final.dubm",
        "ivector/splice.conf", "ivector/global_cmvn.stats"
    ).all { relative -> File(directory, relative).let { it.isFile && it.length() > 0 } } &&
        File(directory, "ivector/online_cmvn.conf").isFile // Empty in the official model.

private fun File.mkdirsOrThrow() {
    if (!isDirectory && !mkdirs()) throw IOException("Unable to create offline voice model storage.")
}

private fun checkCancelled(isCancelled: () -> Boolean) {
    if (isCancelled() || Thread.currentThread().isInterrupted) throw InterruptedIOException("Voice preparation cancelled.")
}
