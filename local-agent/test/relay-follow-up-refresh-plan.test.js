const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRelayFollowUpRefreshPasses,
} = require("../dist/src/relay-follow-up-refresh-plan.js");

test("buildRelayFollowUpRefreshPasses adds an immediate catalog pass for authenticated recovery", () => {
  const passes = buildRelayFollowUpRefreshPasses(
    "controller-authenticated",
    [300, 1500, 5000],
    { includeImmediateCatalogPass: true },
  );

  assert.deepEqual(
    passes.map((pass) => ({
      stage: pass.stage,
      delayMs: pass.delayMs,
      reason: pass.reason,
      refreshProjectCatalog: pass.refreshProjectCatalog,
      refreshWorkgroupCatalog: pass.refreshWorkgroupCatalog,
      syncProjects: pass.syncProjects,
      syncWorkgroups: pass.syncWorkgroups,
    })),
    [
      {
        stage: "catalog",
        delayMs: 0,
        reason: "controller-authenticated",
        refreshProjectCatalog: true,
        refreshWorkgroupCatalog: true,
        syncProjects: false,
        syncWorkgroups: false,
      },
      {
        stage: "catch-up",
        delayMs: 300,
        reason: "controller-authenticated:300",
        refreshProjectCatalog: true,
        refreshWorkgroupCatalog: true,
        syncProjects: true,
        syncWorkgroups: true,
      },
      {
        stage: "stabilize",
        delayMs: 1500,
        reason: "controller-authenticated:1500",
        refreshProjectCatalog: true,
        refreshWorkgroupCatalog: true,
        syncProjects: true,
        syncWorkgroups: true,
      },
      {
        stage: "stabilize",
        delayMs: 5000,
        reason: "controller-authenticated:5000",
        refreshProjectCatalog: true,
        refreshWorkgroupCatalog: true,
        syncProjects: true,
        syncWorkgroups: true,
      },
    ],
  );
});

test("buildRelayFollowUpRefreshPasses keeps the scheduled-only plan for manual reconnects", () => {
  const passes = buildRelayFollowUpRefreshPasses("manual-reconnect", [300, 1500, 5000]);

  assert.equal(passes.length, 3);
  assert.equal(passes[0].stage, "catch-up");
  assert.equal(passes[0].reason, "manual-reconnect:300");
  assert.equal(passes.at(-1).stage, "stabilize");
  assert.equal(passes.at(-1).reason, "manual-reconnect:5000");
});
