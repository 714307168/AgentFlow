const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLoginItemArgs,
  hasHiddenLaunchArg,
  hasUpdatedLaunchArg,
  shouldShowWorkspaceOnStartup,
} = require("../dist/src/desktop-launch-mode.js");

test("hidden launch args are detected for background startup", () => {
  assert.equal(hasHiddenLaunchArg(["AgentFlow.exe", "--hidden"]), true);
  assert.equal(hasHiddenLaunchArg(["AgentFlow.exe", "--background"]), true);
  assert.equal(hasHiddenLaunchArg(["AgentFlow.exe"]), false);
});

test("updated launch arg is detected separately from hidden startup", () => {
  assert.equal(hasUpdatedLaunchArg(["AgentFlow.exe", "--updated"]), true);
  assert.equal(hasUpdatedLaunchArg(["AgentFlow.exe", "--hidden"]), false);
});

test("ordinary double click shows the workspace even when silent launch is enabled", () => {
  assert.equal(
    shouldShowWorkspaceOnStartup({
      silentLaunch: true,
      argv: ["AgentFlow.exe"],
    }),
    true,
  );
});

test("auto-start hidden launch stays in tray when silent launch is enabled", () => {
  assert.equal(
    shouldShowWorkspaceOnStartup({
      silentLaunch: true,
      argv: ["AgentFlow.exe", "--hidden"],
    }),
    false,
  );
});

test("updated launch opens the workspace even when silent launch is enabled", () => {
  assert.equal(
    shouldShowWorkspaceOnStartup({
      silentLaunch: true,
      argv: ["AgentFlow.exe", "--updated"],
    }),
    true,
  );
});

test("login item args include hidden flag only for silent launch", () => {
  assert.deepEqual(buildLoginItemArgs(true), ["--hidden"]);
  assert.deepEqual(buildLoginItemArgs(false), []);
});
