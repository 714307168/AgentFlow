package com.claudecode.remote.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProviderUiTest {

    @Test
    fun providerLabelNormalizesKnownIdsAndFallsBackToClaude() {
        assertEquals("OpenAI Codex", ProviderUi.label("codex"))
        assertEquals("OpenAI Codex", ProviderUi.label("CODEX"))
        assertEquals("Claude Code", ProviderUi.label("claude"))
        assertEquals("Claude Code", ProviderUi.label("unknown"))
    }

    @Test
    fun androidClientCapabilitiesExposeAttachmentSupportInTheSharedLayer() {
        assertTrue(ClientCapabilities.supportsMessageAttachments)
        assertTrue(ClientCapabilities.supportsInlineAttachmentPreview)
    }
}
