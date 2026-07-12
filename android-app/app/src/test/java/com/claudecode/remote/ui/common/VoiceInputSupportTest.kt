package com.claudecode.remote.ui.common

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceInputSupportTest {
    @Test
    fun appendVoiceInputTextKeepsExistingDraftReadable() {
        assertEquals("hello", appendVoiceInputText("", " hello "))
        assertEquals("hello world", appendVoiceInputText("hello", "world"))
        assertEquals("hello world", appendVoiceInputText("hello ", "world"))
        assertEquals("hello", appendVoiceInputText("hello", " "))
    }
}
