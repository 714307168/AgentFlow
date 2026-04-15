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

  return {
    PROVIDERS,
    normalizeProviderId,
    getProviderEntry,
    getProviderLabel,
    getProviderCapabilityLabel,
    listProviders,
  };
});
