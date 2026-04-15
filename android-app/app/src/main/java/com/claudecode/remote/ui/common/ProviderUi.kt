package com.claudecode.remote.ui.common

object ProviderUi {
    fun label(provider: String): String =
        if (provider.equals("codex", ignoreCase = true)) "OpenAI Codex" else "Claude Code"
}
