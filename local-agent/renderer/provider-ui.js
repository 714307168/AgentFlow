(function initProviderUi(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ProviderUi = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createProviderUi() {
  const PROVIDERS = [
    {
      id: "claude",
      label: "Claude Code",
      apiKeyField: "anthropicApiKey",
      capabilityKeys: [
        "promptExecution",
        "resumeConversation",
        "versionCommand",
        "nativeTools",
      ],
    },
    {
      id: "codex",
      label: "OpenAI Codex",
      apiKeyField: "openaiApiKey",
      capabilityKeys: [
        "promptExecution",
        "resumeConversation",
        "webSearch",
        "reviewCommand",
        "featuresCommand",
        "mcpCommand",
        "completionCommand",
        "versionCommand",
        "nativeTools",
      ],
    },
  ];

  const MODEL_PROVIDER_PRESETS = [
    {
      id: "openai",
      name: "OpenAI",
      protocol: "openai",
      baseUrl: "https://api.openai.com",
      defaultModel: "gpt-5.4",
      description: "Official OpenAI-compatible API endpoint.",
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai",
      baseUrl: "https://api.deepseek.com",
      defaultModel: "deepseek-chat",
      description: "DeepSeek chat models through an OpenAI-compatible API.",
    },
    {
      id: "zhipu",
      name: "智谱 GLM",
      protocol: "openai",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      defaultModel: "glm-4.5",
      description: "Zhipu GLM OpenAI-compatible API mode.",
    },
    {
      id: "minimax-mimo",
      name: "MiniMax / Mimo",
      protocol: "openai",
      baseUrl: "https://api.minimax.chat/v1",
      defaultModel: "MiniMax-M1",
      description: "MiniMax and Mimo-style OpenAI-compatible models.",
    },
    {
      id: "hunyuan",
      name: "腾讯混元",
      protocol: "openai",
      baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
      defaultModel: "hunyuan-turbos-latest",
      description: "Tencent Hunyuan OpenAI-compatible API endpoint.",
    },
    {
      id: "aliyun-qwen",
      name: "阿里通义千问",
      protocol: "openai",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      defaultModel: "qwen-plus",
      description: "Alibaba DashScope OpenAI-compatible API mode.",
    },
    {
      id: "anthropic",
      name: "Anthropic Claude",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      defaultModel: "claude-3-7-sonnet-latest",
      description: "Official Anthropic Messages API endpoint.",
    },
  ];

  function normalizeProviderId(provider) {
    return provider === "codex" ? "codex" : "claude";
  }

  function getProviderEntry(provider) {
    const normalized = normalizeProviderId(provider);
    return PROVIDERS.find((entry) => entry.id === normalized) || PROVIDERS[0];
  }

  function getProviderLabel(provider) {
    return getProviderEntry(provider).label;
  }

  function getProviderCapabilityLabel(provider, key, lang) {
    const isZh = lang === "zh";
    switch (key) {
      case "promptExecution":
        return isZh ? "执行任务" : "Prompt Runs";
      case "resumeConversation":
        return isZh ? "续接会话" : "Resume";
      case "webSearch":
        return isZh ? "联网搜索" : "Web Search";
      case "reviewCommand":
        return isZh ? "代码评审" : "Review";
      case "featuresCommand":
        return isZh ? "特性列表" : "Features";
      case "mcpCommand":
        return "MCP";
      case "completionCommand":
        return isZh ? "补全脚本" : "Completion";
      case "versionCommand":
        return isZh ? "版本查询" : "Version";
      case "nativeTools":
        return normalizeProviderId(provider) === "codex"
          ? (isZh ? "内置工具" : "Built-in Tools")
          : (isZh ? "原生工具" : "Native Tools");
      default:
        return key;
    }
  }

  function listProviders() {
    return PROVIDERS.map((entry) => ({ ...entry, capabilityKeys: [...entry.capabilityKeys] }));
  }

  function listModelProviderPresets() {
    return MODEL_PROVIDER_PRESETS.map((entry) => ({ ...entry }));
  }

  return {
    PROVIDERS,
    normalizeProviderId,
    getProviderEntry,
    getProviderLabel,
    getProviderCapabilityLabel,
    listProviders,
    listModelProviderPresets,
  };
});
