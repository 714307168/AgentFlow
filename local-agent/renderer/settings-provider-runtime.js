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

  function getProviderAvailability(statusMap, provider) {
    const normalized = normalizeProviderId(provider);
    const status = statusMap && typeof statusMap === "object" ? statusMap[normalized] : null;
    if (!status || typeof status.installed !== "boolean") {
      return "unknown";
    }
    return status.installed ? "installed" : "missing";
  }

  function getProviderOptions(statusMap, selectedProvider) {
    const normalizedSelected = normalizeProviderId(selectedProvider);
    return PROVIDERS.map((provider) => {
      const availability = getProviderAvailability(statusMap, provider.id);
      return {
        id: provider.id,
        label: provider.label,
        availability,
        selected: provider.id === normalizedSelected,
        disabled: availability === "missing" && provider.id !== normalizedSelected,
      };
    });
  }

  function getFirstSelectableProvider(statusMap, preferredProvider) {
    const preferred = normalizeProviderId(preferredProvider);
    if (getProviderAvailability(statusMap, preferred) !== "missing") {
      return preferred;
    }
    const nextAvailable = PROVIDERS.find((provider) => getProviderAvailability(statusMap, provider.id) !== "missing");
    return nextAvailable?.id || preferred;
  }

  return {
    PROVIDERS,
    normalizeProviderId,
    getProviderLabel,
    getProviderAvailability,
    getProviderOptions,
    getFirstSelectableProvider,
  };
});
