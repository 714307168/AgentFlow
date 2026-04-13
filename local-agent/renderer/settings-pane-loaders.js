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
    const includeDevices = options.includeDevices !== false;
    const includeTransfers = options.includeTransfers !== false;
    const jobs = [];
    if (includeLocalData) {
      jobs.push(deps.refreshLocalDataMetrics({ force }));
    }
    if (includeDevices) {
      jobs.push(deps.loadRelayDevices({ force }));
    }
    if (includeTransfers) {
      jobs.push(deps.refreshRelayTransfers({ force }));
    }
    await Promise.all(jobs);
  }

  async function applyTransferFilterChange(deps, options = {}) {
    const force = options.force !== false;
    if (typeof deps.syncTransferFilterFields === "function") {
      deps.syncTransferFilterFields();
    }
    if (typeof deps.markTransfersDirty === "function") {
      deps.markTransfersDirty();
    }
    await deps.refreshRelayTransfers({ force });
  }

  async function requestTransferRefresh(deps, options = {}) {
    const force = options.force !== false;
    const includeDevices = options.includeDevices === true;
    const includeTransfers = options.includeTransfers !== false;
    const includeLocalData = options.includeLocalData === true;
    if (typeof deps.markTransfersDirty === "function" && includeTransfers) {
      deps.markTransfersDirty();
    }
    if (typeof deps.markTransferDevicesDirty === "function" && includeDevices) {
      deps.markTransferDevicesDirty();
    }
    await refreshTransferPaneData(deps, {
      force,
      includeDevices,
      includeTransfers,
      includeLocalData,
    });
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
    applyTransferFilterChange,
    loadAutomationPaneData,
    loadMessagePaneData,
    loadOverviewPaneData,
    refreshTransferPaneData,
    requestTransferRefresh,
  };
});
