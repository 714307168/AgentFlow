package com.claudecode.remote.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException

class VoiceInputSupportTest {
    @Test
    fun appendVoiceInputTextKeepsExistingDraftReadable() {
        assertEquals("hello", appendVoiceInputText("", " hello "))
        assertEquals("hello world", appendVoiceInputText("hello", "world"))
        assertEquals("hello world", appendVoiceInputText("hello ", "world"))
        assertEquals("hello", appendVoiceInputText("hello", " "))
    }

    @Test
    fun offlineVoiceModelHelpersRejectUnsafeArchivesAndReadFinalText() {
        val root = createTempDir(prefix = "voice-model-")
        try {
            assertTrue(resolveSafeZipDestination(root, "model/am/final.mdl").path.startsWith(root.path))
            assertFalse(isUsableModelDirectory(root))
            try {
                resolveSafeZipDestination(root, "../outside")
                throw AssertionError("Unsafe archive path should be rejected")
            } catch (_: IOException) {
                // Expected: extraction must remain inside the model directory.
            }
            assertEquals("hello", extractOfflineVoiceText("{\"text\":\" hello \"}"))
            assertEquals("", extractOfflineVoiceText("not json"))
            assertEquals("你好", extractOfflineVoiceText("{\"partial\":\"你好\"}", "partial"))
            assertEquals("说\"你好\"", extractOfflineVoiceText("{\"text\":\"说\\\"你好\\\"\"}"))
            assertEquals("", extractOfflineVoiceText("{\"text\":null}"))
            assertEquals("", extractOfflineVoiceText("{\"text\":42}"))
        } finally {
            root.deleteRecursively()
        }
    }
}
