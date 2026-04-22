const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyDesktopStartupModePlan,
  buildDesktopStartupModePlan,
} = require("../dist/src/desktop-startup-mode.js");

test("desktop startup mode stays unchanged on modern Windows by default", () => {
  assert.deepEqual(buildDesktopStartupModePlan({
    platform: "win32",
    osRelease: "10.0.19045",
    argv: ["AgentFlow.exe"],
    env: {},
  }), {
    safeGraphics: false,
    disableHardwareAcceleration: false,
    switches: [],
    reasons: [],
  });
});

test("desktop startup mode enables safe graphics on legacy Windows builds", () => {
  const plan = buildDesktopStartupModePlan({
    platform: "win32",
    osRelease: "10.0.14393",
    argv: ["AgentFlow.exe"],
    env: {},
  });

  assert.equal(plan.safeGraphics, true);
  assert.equal(plan.disableHardwareAcceleration, true);
  assert.deepEqual(plan.reasons, ["legacy-windows-build"]);
  assert.deepEqual(plan.switches, [
    { name: "disable-gpu" },
    { name: "disable-gpu-compositing" },
    { name: "disable-features", value: "CalculateNativeWinOcclusion" },
  ]);
});

test("desktop startup mode can be forced manually", () => {
  const plan = buildDesktopStartupModePlan({
    platform: "linux",
    osRelease: "6.8.0",
    argv: ["agentflow", "--safe-mode"],
    env: {},
  });

  assert.equal(plan.safeGraphics, true);
  assert.deepEqual(plan.reasons, ["manual-safe-mode"]);
});

test("desktop startup mode also respects environment safe mode", () => {
  const plan = buildDesktopStartupModePlan({
    platform: "win32",
    osRelease: "10.0.19045",
    argv: ["AgentFlow.exe"],
    env: { AGENTFLOW_SAFE_MODE: "true" },
  });

  assert.equal(plan.safeGraphics, true);
  assert.deepEqual(plan.reasons, ["manual-safe-mode"]);
});

test("applyDesktopStartupModePlan appends switches only when safe mode is enabled", () => {
  const appended = [];
  let disabledHardwareAcceleration = 0;
  applyDesktopStartupModePlan({
    disableHardwareAcceleration() {
      disabledHardwareAcceleration += 1;
    },
    commandLine: {
      appendSwitch(name, value) {
        appended.push(value === undefined ? { name } : { name, value });
      },
    },
  }, buildDesktopStartupModePlan({
    platform: "win32",
    osRelease: "10.0.14393",
    argv: ["AgentFlow.exe"],
    env: {},
  }));

  assert.equal(disabledHardwareAcceleration, 1);
  assert.deepEqual(appended, [
    { name: "disable-gpu" },
    { name: "disable-gpu-compositing" },
    { name: "disable-features", value: "CalculateNativeWinOcclusion" },
  ]);
});
