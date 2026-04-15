(function initSettingsProviderRuntime(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SettingsProviderRuntime = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSettingsProviderRuntime(root) {
  const providerUi = root?.ProviderUi || null;
  const PROVIDERS = providerUi?.listProviders
    ? providerUi.listProviders()
    : [
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

  function getProviderLabel(provider) {
    return providerUi?.getProviderLabel?.(provider) || getProviderEntry(provider).label;
  }

  function getProviderEntry(provider) {
    const normalized = normalizeProviderId(provider);
    return PROVIDERS.find((entry) => entry.id === normalized) || PROVIDERS[0];
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
    if (!config || typeof config !== "object") {
      return false;
    }
    const apiKeyField = getProviderEntry(provider).apiKeyField;
    const apiKey = config[apiKeyField];
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
    const entry = getProviderEntry(provider);
    const capabilities = status && status.capabilities && typeof status.capabilities === "object"
      ? status.capabilities
      : {};
    return entry.capabilityKeys.map((key) => ({
      key,
      available: capabilities[key] === true,
    }));
  }

  function getProviderCapabilityLabel(provider, key, lang) {
    return providerUi?.getProviderCapabilityLabel?.(provider, key, lang === "zh" ? "zh" : "en") || key;
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
    getProviderCapabilityLabel,
  };
});
