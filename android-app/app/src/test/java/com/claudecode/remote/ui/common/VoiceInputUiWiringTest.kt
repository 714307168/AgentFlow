package com.claudecode.remote.ui.common

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceInputUiWiringTest {
    private val root = File("src/main/java/com/claudecode/remote")

    @Test
    fun projectAndWorkgroupChatExposeVoiceInputActions() {
        val projectChat = root.resolve("ui/chat/ChatScreen.kt").readText()
        val workgroupChat = root.resolve("ui/workgroup/WorkgroupChatScreen.kt").readText()

        assertTrue(projectChat.contains("ActivityResultContracts.StartActivityForResult"))
        assertTrue(projectChat.contains("Icons.Default.Mic"))
        assertTrue(projectChat.contains("onVoiceInput"))
        assertTrue(workgroupChat.contains("ActivityResultContracts.StartActivityForResult"))
        assertTrue(workgroupChat.contains("Icons.Default.Mic"))
        assertTrue(workgroupChat.contains("onVoiceInput"))
    }
}
