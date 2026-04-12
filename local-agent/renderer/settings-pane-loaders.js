(function initSettingsPaneLoaders(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SettingsPaneLoaders = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSettingsPaneLoaders() {
  async function refreshTransferPaneData(deps, options = {}) {
    const force = options.force === true;
    const includeLocalData = options.includeLocalData === true;
    const jobs = [];
    if (includeLocalData) {
      jobs.push(deps.refreshLocalDataMetrics({ force }));
    }
    jobs.push(
      deps.loadRelayDevices({ force }),
      deps.refreshRelayTransfers({ force }),
    );
    await Promise.all(jobs);
  }

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
      (async () => {
        await deps.loadProjects({ force });
        await deps.loadWorkgroups({ force, skipProjectRefresh: true });
      })(),
      refreshTransferPaneData(deps, { force, includeLocalData: true }),
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
    refreshTransferPaneData,
  };
});
