(function initSettingsRuntimeGuide(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SettingsRuntimeGuide = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSettingsRuntimeGuide() {
  function normalizeProviderId(provider) {
    return provider === "codex" ? "codex" : "claude";
  }

  function getProviderInstallCommand(provider) {
    return normalizeProviderId(provider) === "codex"
      ? "npm install -g @openai/codex@latest"
      : "npm install -g @anthropic-ai/claude-code@latest";
  }

  function getProviderRuntimeGuide(provider, status, apiFallbackReady) {
    if (apiFallbackReady) {
      return null;
    }

    const normalizedProvider = normalizeProviderId(provider);
    if (status?.installed !== true) {
      return {
        kind: "install",
        provider: normalizedProvider,
        command: getProviderInstallCommand(normalizedProvider),
      };
    }

    if (status?.capabilities?.promptExecution === false) {
      return {
        kind: "repair",
        provider: normalizedProvider,
        command: status?.upgrade?.commandPreview || getProviderInstallCommand(normalizedProvider),
      };
    }

    return null;
  }

  return {
    getProviderInstallCommand,
    getProviderRuntimeGuide,
  };
});
