(function initSettingsPaneLoaders(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SettingsPaneLoaders = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSettingsPaneLoaders() {
  async function loadOverviewPaneData(deps, options = {}) {
    const force = options.force === true;
    await Promise.all([
      deps.refreshLocalDataMetrics({ force }),
      deps.loadAccessGrants({ force }),
      (async () => {
        await deps.loadProjects({ force });
        await Promise.all([
          deps.loadWorkgroups({ force, skipProjectRefresh: true }),
          deps.loadScheduledTasks({ force, skipProjectRefresh: true }),
        ]);
      })(),
    ]);
  }

  async function loadMessagePaneData(deps, options = {}) {
    const force = options.force === true;
    await Promise.all([
      deps.refreshLocalDataMetrics({ force }),
      (async () => {
        await deps.loadProjects({ force });
        await deps.loadWorkgroups({ force, skipProjectRefresh: true });
      })(),
      deps.loadRelayDevices({ force }),
      deps.refreshRelayTransfers({ force }),
    ]);
  }

  async function loadAutomationPaneData(deps, options = {}) {
    const force = options.force === true;
    await deps.loadProjects({ force });
    await deps.loadScheduledTasks({ force, skipProjectRefresh: true });
  }

  return {
    loadAutomationPaneData,
    loadMessagePaneData,
    loadOverviewPaneData,
  };
});
