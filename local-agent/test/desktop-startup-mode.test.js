const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

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
    { name: "disable-accelerated-2d-canvas" },
    { name: "disable-accelerated-video-decode" },
    { name: "disable-gpu-memory-buffer-video-frames" },
    { name: "disable-zero-copy" },
    { name: "disable-features", value: "CalculateNativeWinOcclusion" },
  ]);
});

test("desktop startup mode enables Linux compatibility by default", () => {
  const plan = buildDesktopStartupModePlan({
    platform: "linux",
    osRelease: "6.8.0",
    argv: ["agentflow"],
    env: {},
  });

  assert.equal(plan.safeGraphics, true);
  assert.equal(plan.disableHardwareAcceleration, false);
  assert.deepEqual(plan.reasons, ["linux-compatibility-mode"]);
  assert.deepEqual(plan.switches, [
    {
      name: "disable-features",
      value: "WaylandWindowDecorations",
    },
    { name: "no-sandbox" },
    { name: "disable-dev-shm-usage" },
    { name: "ozone-platform", value: "x11" },
  ]);
});

test("desktop startup mode can be forced manually", () => {
  const plan = buildDesktopStartupModePlan({
    platform: "darwin",
    osRelease: "6.8.0",
    argv: ["agentflow", "--safe-mode"],
    env: {},
  });

  assert.equal(plan.safeGraphics, true);
  assert.deepEqual(plan.reasons, ["manual-safe-mode"]);
});

test("desktop startup mode can disable Linux compatibility explicitly", () => {
  const plan = buildDesktopStartupModePlan({
    platform: "linux",
    osRelease: "6.8.0",
    argv: ["agentflow"],
    env: { AGENTFLOW_DISABLE_LINUX_COMPATIBILITY_MODE: "true" },
  });

  assert.deepEqual(plan, {
    safeGraphics: false,
    disableHardwareAcceleration: false,
    switches: [],
    reasons: [],
  });
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
    { name: "disable-accelerated-2d-canvas" },
    { name: "disable-accelerated-video-decode" },
    { name: "disable-gpu-memory-buffer-video-frames" },
    { name: "disable-zero-copy" },
    { name: "disable-features", value: "CalculateNativeWinOcclusion" },
  ]);
});

test("desktop windows keep load diagnostics for packaged Linux black screen failures", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.ts"), "utf8");
  const workspaceCss = fs.readFileSync(path.join(__dirname, "../renderer/styles.css"), "utf8");
  const settingsHtml = fs.readFileSync(path.join(__dirname, "../renderer/settings.html"), "utf8");

  assert.match(mainSource, /function bindWindowDiagnostics/);
  assert.match(mainSource, /did-fail-load/);
  assert.match(mainSource, /render-process-gone/);
  assert.match(mainSource, /Window did not become ready-to-show within 8 seconds/);
  assert.match(mainSource, /const useNativeWindowFrame = process\.platform === "linux"/);
  assert.match(mainSource, /frame: useNativeWindowFrame/);
  assert.match(mainSource, /markNativeWindowFrame\(mainWindow\)/);
  assert.match(mainSource, /markNativeWindowFrame\(win\)/);
  assert.match(mainSource, /bindWindowDiagnostics\(mainWindow, "settingsWindow"/);
  assert.match(mainSource, /bindWindowDiagnostics\(win, "workspaceWindow"/);
  assert.match(workspaceCss, /\.native-window-frame \.titlebar\s*\{\s*display: none;/);
  assert.match(settingsHtml, /\.native-window-frame \.titlebar\s*\{\s*display: none;/);
});
