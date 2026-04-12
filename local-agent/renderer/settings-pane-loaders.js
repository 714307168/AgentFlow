(function initSettingsPaneLoaders(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SettingsPaneLoaders = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSettingsPaneLoaders() {
  async function loadMessagePaneData(deps, options = {}) {
    const force = options.force === true;
    await Promise.all([
      deps.refreshLocalDataMetrics(),
      (async () => {
        await deps.loadProjects({ force });
        await deps.loadWorkgroups({ force, skipProjectRefresh: true });
      })(),
      deps.loadRelayDevices(),
      deps.refreshRelayTransfers(),
    ]);
  }

  return {
    loadMessagePaneData,
  };
});
