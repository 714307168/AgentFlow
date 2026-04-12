const test = require("node:test");
const assert = require("node:assert/strict");

const {
  loadAutomationPaneData,
  loadMessagePaneData,
} = require("../renderer/settings-pane-loaders.js");

test("loadMessagePaneData loads projects before workgroups and skips the duplicate project refresh inside workgroups", async () => {
  const calls = [];
  let projectsResolved = false;

  await loadMessagePaneData({
    refreshLocalDataMetrics: async () => {
      calls.push("localData:start");
      await Promise.resolve();
      calls.push("localData:done");
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
    loadRelayDevices: async () => {
      calls.push("devices");
    },
    refreshRelayTransfers: async () => {
      calls.push("transfers");
    },
  }, { force: true });

  assert.deepEqual(calls, [
    "localData:start",
    "projects:{\"force\":true}",
    "devices",
    "transfers",
    "localData:done",
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
