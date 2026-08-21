package com.claudecode.remote.ui.common

object ProviderUi {
    data class ModelPreset(
        val name: String,
        val model: String
    )

    fun label(provider: String): String =
        if (provider.equals("codex", ignoreCase = true)) "OpenAI Codex" else "Claude Code"

    fun defaultModels(provider: String): List<ModelPreset> =
        if (provider.equals("codex", ignoreCase = true)) {
            listOf(
                ModelPreset("OpenAI", "gpt-5.6-terra"),
                ModelPreset("DeepSeek", "deepseek-chat"),
                ModelPreset("智谱 GLM", "glm-4.5"),
                ModelPreset("MiniMax / Mimo", "MiniMax-M1"),
                ModelPreset("腾讯混元", "hunyuan-turbos-latest"),
                ModelPreset("阿里通义千问", "qwen-plus")
            )
        } else {
            listOf(
                ModelPreset("Anthropic Claude", "claude-sonnet-4-5")
            )
        }
}
