const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyTransferFilterChange,
  loadAutomationPaneData,
  loadMessagePaneData,
  loadOverviewPaneData,
  refreshTransferPaneData,
  requestTransferRefresh,
} = require("../renderer/settings-pane-loaders.js");

test("loadOverviewPaneData loads projects once before workgroups and scheduled tasks reuse the same catalog", async () => {
  const calls = [];
  let projectsResolved = false;

  await loadOverviewPaneData({
    refreshLocalDataMetrics: async (options = {}) => {
      calls.push(`localData:${JSON.stringify(options)}:start`);
      await Promise.resolve();
      calls.push(`localData:${JSON.stringify(options)}:done`);
    },
    loadAccessGrants: async (options = {}) => {
      calls.push(`access:${JSON.stringify(options)}:start`);
      await Promise.resolve();
      calls.push(`access:${JSON.stringify(options)}:done`);
    },
    loadProjects: async (options = {}) => {
      calls.push(`projects:${JSON.stringify(options)}`);
      await Promise.resolve();
      projectsResolved = true;
    },
    loadWorkgroups: async (options = {}) => {
      calls.push(`workgroups:${JSON.stringify(options)}`);
      assert.equal(projectsResolved, true);
      assert.equal(options.skipProjectRefresh, true);
    },
    loadScheduledTasks: async (options = {}) => {
      calls.push(`tasks:${JSON.stringify(options)}`);
      assert.equal(projectsResolved, true);
      assert.equal(options.skipProjectRefresh, true);
    },
  }, { force: true });

  assert.deepEqual(calls, [
    "localData:{\"force\":true}:start",
    "access:{\"force\":true}:start",
    "projects:{\"force\":true}",
    "localData:{\"force\":true}:done",
    "access:{\"force\":true}:done",
    "workgroups:{\"force\":true,\"skipProjectRefresh\":true}",
    "tasks:{\"force\":true,\"skipProjectRefresh\":true}",
  ]);
});

test("refreshTransferPaneData propagates force to relay refreshers and optionally includes local metrics", async () => {
  const calls = [];

  await refreshTransferPaneData({
    refreshLocalDataMetrics: async (options = {}) => {
      calls.push(`localData:${JSON.stringify(options)}`);
    },
    loadRelayDevices: async (options = {}) => {
      calls.push(`devices:${JSON.stringify(options)}`);
    },
    refreshRelayTransfers: async (options = {}) => {
      calls.push(`transfers:${JSON.stringify(options)}`);
    },
  }, { force: true, includeLocalData: true });

  assert.deepEqual(calls, [
    "localData:{\"force\":true}",
    "devices:{\"force\":true}",
    "transfers:{\"force\":true}",
  ]);
});

test("requestTransferRefresh marks transfer state and refreshes only the requested transfer resources", async () => {
  const calls = [];

  await requestTransferRefresh({
    markTransfersDirty: () => {
      calls.push("dirty:transfers");
    },
    markTransferDevicesDirty: () => {
      calls.push("dirty:devices");
    },
    loadRelayDevices: async (options = {}) => {
      calls.push(`devices:${JSON.stringify(options)}`);
    },
    refreshRelayTransfers: async (options = {}) => {
      calls.push(`transfers:${JSON.stringify(options)}`);
    },
  }, { force: true, includeDevices: true });

  assert.deepEqual(calls, [
    "dirty:transfers",
    "dirty:devices",
    "devices:{\"force\":true}",
    "transfers:{\"force\":true}",
  ]);
});

test("applyTransferFilterChange syncs fields when provided, marks transfers dirty, and forces a refresh by default", async () => {
  const calls = [];

  await applyTransferFilterChange({
    syncTransferFilterFields: () => {
      calls.push("sync");
    },
    markTransfersDirty: () => {
      calls.push("dirty");
    },
    refreshRelayTransfers: async (options = {}) => {
      calls.push(`refresh:${JSON.stringify(options)}`);
    },
  });

  assert.deepEqual(calls, [
    "sync",
    "dirty",
    "refresh:{\"force\":true}",
  ]);
});

test("loadMessagePaneData loads projects before workgroups and skips the duplicate project refresh inside workgroups", async () => {
  const calls = [];
  let projectsResolved = false;

  await loadMessagePaneData({
    refreshLocalDataMetrics: async (options = {}) => {
      calls.push(`localData:${JSON.stringify(options)}:start`);
      await Promise.resolve();
      calls.push(`localData:${JSON.stringify(options)}:done`);
    },
    loadProjects: async (options = {}) => {
      calls.push(`projects:${JSON.stringify(options)}`);
      await Promise.resolve();
      projectsResolved = true;
    },
    loadWorkgroups: async (options = {}) => {
      calls.push(`workgroups:${JSON.stringify(options)}`);
      assert.equal(projectsResolved, true);
      assert.equal(options.skipProjectRefresh, true);
    },
    loadRelayDevices: async (options = {}) => {
      calls.push(`devices:${JSON.stringify(options)}`);
    },
    refreshRelayTransfers: async (options = {}) => {
      calls.push(`transfers:${JSON.stringify(options)}`);
    },
  }, { force: true });

  assert.deepEqual(calls, [
    "projects:{\"force\":true}",
    "localData:{\"force\":true}:start",
    "devices:{\"force\":true}",
    "transfers:{\"force\":true}",
    "localData:{\"force\":true}:done",
    "workgroups:{\"force\":true,\"skipProjectRefresh\":true}",
  ]);
});

test("loadAutomationPaneData loads projects first and asks scheduled tasks to reuse that catalog", async () => {
  const calls = [];

  await loadAutomationPaneData({
    loadProjects: async (options = {}) => {
      calls.push(`projects:${JSON.stringify(options)}`);
    },
    loadScheduledTasks: async (options = {}) => {
      calls.push(`tasks:${JSON.stringify(options)}`);
      assert.equal(options.skipProjectRefresh, true);
    },
  }, { force: true });

  assert.deepEqual(calls, [
    "projects:{\"force\":true}",
    "tasks:{\"force\":true,\"skipProjectRefresh\":true}",
  ]);
});
