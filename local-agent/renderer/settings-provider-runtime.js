(function initSettingsProviderRuntime(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SettingsProviderRuntime = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSettingsProviderRuntime() {
  const PROVIDERS = [
    { id: "claude", label: "Claude Code" },
    { id: "codex", label: "OpenAI Codex" },
  ];

  function normalizeProviderId(provider) {
    return provider === "codex" ? "codex" : "claude";
  }

  function getProviderLabel(provider) {
    const normalized = normalizeProviderId(provider);
    return PROVIDERS.find((entry) => entry.id === normalized)?.label || "Claude Code";
  }

  function getProviderAvailability(statusMap, provider, config) {
    const normalized = normalizeProviderId(provider);
    const status = statusMap && typeof statusMap === "object" ? statusMap[normalized] : null;
    if (!status || typeof status.installed !== "boolean") {
      return hasProviderApiFallback(config, normalized) ? "fallback" : "unknown";
    }
    const runtimeMode = getProviderRuntimeMode(statusMap, config, normalized);
    if (runtimeMode === "cli") {
      return "installed";
    }
    if (runtimeMode === "sdk") {
      return "fallback";
    }
    return status.installed ? "degraded" : "missing";
  }

  function getProviderOptions(statusMap, selectedProvider, config) {
    const normalizedSelected = normalizeProviderId(selectedProvider);
    return PROVIDERS.map((provider) => {
      const availability = getProviderAvailability(statusMap, provider.id, config);
      return {
        id: provider.id,
        label: provider.label,
        availability,
        selected: provider.id === normalizedSelected,
        disabled: (availability === "missing" || availability === "degraded") && provider.id !== normalizedSelected,
      };
    });
  }

  function getFirstSelectableProvider(statusMap, preferredProvider, config) {
    const preferred = normalizeProviderId(preferredProvider);
    const preferredAvailability = getProviderAvailability(statusMap, preferred, config);
    if (preferredAvailability !== "missing" && preferredAvailability !== "degraded") {
      return preferred;
    }
    const nextAvailable = PROVIDERS.find((provider) => {
      const availability = getProviderAvailability(statusMap, provider.id, config);
      return availability !== "missing" && availability !== "degraded";
    });
    return nextAvailable?.id || preferred;
  }

  function hasProviderApiFallback(config, provider) {
    const normalized = normalizeProviderId(provider);
    if (!config || typeof config !== "object") {
      return false;
    }
    const apiKey = normalized === "codex"
      ? config.openaiApiKey
      : config.anthropicApiKey;
    return Boolean(typeof apiKey === "string" && apiKey.trim());
  }

  function getProviderRuntimeMode(statusMap, config, provider) {
    const normalized = normalizeProviderId(provider);
    const status = statusMap && typeof statusMap === "object" ? statusMap[normalized] : null;
    const promptExecutionAvailable = status?.installed === true
      && (!status.capabilities || status.capabilities.promptExecution !== false);
    if (promptExecutionAvailable) {
      return "cli";
    }
    if (hasProviderApiFallback(config, normalized)) {
      return "sdk";
    }
    return "unavailable";
  }

  function getInstallMethodLabel(installMethod) {
    switch (installMethod) {
      case "npm":
        return "npm";
      case "brew":
        return "Homebrew";
      case "scoop":
        return "Scoop";
      case "winget":
        return "Winget";
      default:
        return null;
    }
  }

  function getProviderCapabilityEntries(provider, status) {
    const normalized = normalizeProviderId(provider);
    const capabilities = status && status.capabilities && typeof status.capabilities === "object"
      ? status.capabilities
      : {};
    const keys = normalized === "codex"
      ? [
        "promptExecution",
        "resumeConversation",
        "webSearch",
        "reviewCommand",
        "featuresCommand",
        "mcpCommand",
        "completionCommand",
        "versionCommand",
        "nativeTools",
      ]
      : [
        "promptExecution",
        "resumeConversation",
        "versionCommand",
        "nativeTools",
      ];
    return keys.map((key) => ({
      key,
      available: capabilities[key] === true,
    }));
  }

  return {
    PROVIDERS,
    normalizeProviderId,
    getProviderLabel,
    getProviderAvailability,
    getProviderOptions,
    getFirstSelectableProvider,
    hasProviderApiFallback,
    getProviderRuntimeMode,
    getInstallMethodLabel,
    getProviderCapabilityEntries,
  };
});
