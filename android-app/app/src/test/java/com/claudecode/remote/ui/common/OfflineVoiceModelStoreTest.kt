package com.claudecode.remote.ui.common

import com.claudecode.remote.BuildConfig
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class OfflineVoiceModelStoreTest {
    @get:Rule val temporary = TemporaryFolder()
    private val requiredFiles = listOf(
        "am/final.mdl", "conf/mfcc.conf", "conf/model.conf", "graph/HCLr.fst", "graph/Gr.fst",
        "graph/disambig_tid.int", "graph/phones/word_boundary.int",
        "ivector/final.ie", "ivector/final.mat", "ivector/final.dubm",
        "ivector/splice.conf", "ivector/global_cmvn.stats", "ivector/online_cmvn.conf"
    )

    @Test
    fun firstUseInstallsBundledArchiveAndSecondUseDoesNotReopenIt() {
        val root = temporary.newFolder()
        val archive = archive()
        val installed = store(root, archive).installIfNeeded()
        assertTrue(isUsableModelDirectory(installed))
        val reused = OfflineVoiceModelStore(root, { error("Must use the installed model") }, hash(archive))
        assertEquals(installed, reused.installIfNeeded())
        assertNoStaging(root)
    }

    @Test
    fun corruptOrLegacyDirectoryIsReplacedWithCompleteModel() {
        val root = temporary.newFolder()
        val store = store(root, archive())
        val installed = store.installIfNeeded()
        File(installed, "am/final.mdl").delete()
        assertNull(store.getInstalledModelDirectory())
        assertTrue(isUsableModelDirectory(store.installIfNeeded()))
        File(installed, "ivector/final.ie").delete()
        assertNull(store.getInstalledModelDirectory())
        assertTrue(isUsableModelDirectory(store.installIfNeeded()))
        File(installed, ".installed").delete()
        assertNull(store.getInstalledModelDirectory())
        assertTrue(isUsableModelDirectory(store.installIfNeeded()))
    }

    @Test
    fun checksumMismatchNeverActivatesAndCleansPartialFiles() {
        val root = temporary.newFolder()
        val store = OfflineVoiceModelStore(root, { archive().inputStream() }, "0".repeat(64))
        assertThrows(IOException::class.java) { store.installIfNeeded() }
        assertNull(store.getInstalledModelDirectory())
        assertNoStaging(root)
    }

    @Test
    fun unsafeZipEntriesCannotEscapeModelStorage() {
        val root = temporary.newFolder()
        val archive = archive(extraPath = "../escaped.txt")
        val store = store(root, archive)
        assertThrows(IOException::class.java) { store.installIfNeeded() }
        assertFalse(File(root, "offline-voice/escaped.txt").exists())
        assertNull(store.getInstalledModelDirectory())
        assertNoStaging(root)
    }

    @Test
    fun zipWithMissingModelFileCannotBecomeInstalled() {
        val root = temporary.newFolder()
        val store = store(root, archive(files = requiredFiles.dropLast(1)))
        assertThrows(IOException::class.java) { store.installIfNeeded() }
        assertNull(store.getInstalledModelDirectory())
        assertNoStaging(root)
    }

    @Test
    fun cancelDuringExtractionCleansFilesAndAllowsRetry() {
        val root = temporary.newFolder()
        val store = store(root, archive())
        var checks = 0
        assertThrows(InterruptedIOException::class.java) {
            store.installIfNeeded { ++checks > 5 }
        }
        assertNull(store.getInstalledModelDirectory())
        assertNoStaging(root)
        assertTrue(isUsableModelDirectory(store.installIfNeeded()))
    }

    @Test
    fun simultaneousCallersShareOneInstallation() {
        val root = temporary.newFolder()
        val archive = archive()
        val opens = AtomicInteger()
        val started = CountDownLatch(1)
        val proceed = CountDownLatch(1)
        val store = OfflineVoiceModelStore(root, {
            opens.incrementAndGet()
            started.countDown()
            check(proceed.await(5, TimeUnit.SECONDS))
            archive.inputStream()
        }, hash(archive))
        val executor = Executors.newFixedThreadPool(2)
        try {
            val first = executor.submit<File> { store.installIfNeeded() }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            val second = executor.submit<File> { store.installIfNeeded() }
            proceed.countDown()
            assertEquals(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS))
            assertEquals(1, opens.get())
        } finally {
            proceed.countDown()
            executor.shutdownNow()
        }
    }

    private fun archive(files: List<String> = requiredFiles, extraPath: String? = null): ByteArray {
        val output = ByteArrayOutputStream()
        ZipOutputStream(output).use { zip ->
            for (file in files) {
                zip.putNextEntry(ZipEntry(BuildConfig.OFFLINE_VOICE_MODEL_NAME + "/" + file))
                zip.write("fixture data".toByteArray())
                zip.closeEntry()
            }
            if (extraPath != null) {
                zip.putNextEntry(ZipEntry(extraPath))
                zip.write("invalid".toByteArray())
                zip.closeEntry()
            }
        }
        return output.toByteArray()
    }

    private fun store(root: File, archive: ByteArray) =
        OfflineVoiceModelStore(root, { archive.inputStream() }, hash(archive))

    private fun hash(bytes: ByteArray) =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun assertNoStaging(root: File) {
        assertFalse(File(root, "offline-voice/model.zip").exists())
        assertFalse(File(root, "offline-voice/staging").exists())
    }
}
