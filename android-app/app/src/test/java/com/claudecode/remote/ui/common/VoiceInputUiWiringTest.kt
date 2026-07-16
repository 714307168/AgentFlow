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
        val support = root.resolve("ui/common/VoiceInputSupport.kt").readText()

        assertTrue(projectChat.contains("rememberVoiceInputLauncher"))
        assertTrue(projectChat.contains("Icons.Default.Mic"))
        assertTrue(projectChat.contains("onVoiceInput"))
        assertTrue(workgroupChat.contains("rememberVoiceInputLauncher"))
        assertTrue(workgroupChat.contains("Icons.Default.Mic"))
        assertTrue(workgroupChat.contains("onVoiceInput"))
        assertTrue(support.contains("ActivityResultContracts.StartActivityForResult"))
        assertTrue(support.contains("ActivityResultContracts.RequestPermission"))
        assertTrue(support.contains("OfflineVoiceRecognizer"))
        assertTrue(root.resolve("ui/common/OfflineVoiceModelStore.kt").exists())
    }
}
