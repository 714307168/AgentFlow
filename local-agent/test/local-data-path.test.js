const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  getBootstrapSettingsPathForEnvironment,
  getDefaultLocalDataRootForEnvironment,
  getPersistedLocalDataRootForEnvironment,
} = require("../dist/src/local-data-path.js");

test("default local data root follows APPDATA on Windows", () => {
  assert.equal(
    getDefaultLocalDataRootForEnvironment({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\lenovo\\AppData\\Roaming" },
      homeDir: "C:\\Users\\lenovo",
    }),
    path.join("C:\\Users\\lenovo\\AppData\\Roaming", "claude-code-agent"),
  );
});

test("persisted local data root falls back to default when no bootstrap file exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-local-data-"));
  const env = { APPDATA: root };
  assert.equal(
    getPersistedLocalDataRootForEnvironment({
      platform: "win32",
      env,
      homeDir: root,
    }),
    path.join(root, "claude-code-agent"),
  );
});

test("persisted local data root respects bootstrap settings override", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-local-data-"));
  const env = { APPDATA: root };
  const bootstrapPath = getBootstrapSettingsPathForEnvironment({
    platform: "win32",
    env,
    homeDir: root,
  });
  fs.mkdirSync(path.dirname(bootstrapPath), { recursive: true });
  fs.writeFileSync(bootstrapPath, JSON.stringify({ localDataRoot: "D:/AgentFlowData" }), "utf8");
  assert.equal(
    getPersistedLocalDataRootForEnvironment({
      platform: "win32",
      env,
      homeDir: root,
    }),
    path.resolve("D:/AgentFlowData"),
  );
});
