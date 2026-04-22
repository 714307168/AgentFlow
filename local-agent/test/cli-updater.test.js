const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectCliInstallMethod,
  buildCliInstallCommand,
  buildCliUpgradeCommand,
  formatCliUpgradeCommandPreview,
} = require("../dist/src/cli-updater.js");

test("detectCliInstallMethod recognizes common install sources", () => {
  assert.equal(detectCliInstallMethod("C:/Users/test/scoop/apps/codex/current/codex.cmd", "win32"), "scoop");
  assert.equal(detectCliInstallMethod("C:/Program Files/nodejs/codex.cmd", "win32"), "npm");
  assert.equal(detectCliInstallMethod("/opt/homebrew/bin/codex", "darwin"), "brew");
  assert.equal(detectCliInstallMethod("C:/Users/test/AppData/Local/Microsoft/WindowsApps/codex.exe", "win32"), "winget");
  assert.equal(detectCliInstallMethod("D:/tools/custom/codex.exe", "win32"), "unknown");
  assert.equal(detectCliInstallMethod("", "win32"), null);
});

test("buildCliUpgradeCommand returns provider-specific package manager commands", () => {
  assert.deepEqual(buildCliUpgradeCommand("codex", "npm", "win32"), {
    command: "npm.cmd",
    args: ["install", "-g", "@openai/codex@latest", "--registry", "https://registry.npmmirror.com"],
    env: {
      ...process.env,
      npm_config_registry: "https://registry.npmmirror.com",
      NPM_CONFIG_REGISTRY: "https://registry.npmmirror.com",
    },
  });

  assert.deepEqual(buildCliUpgradeCommand("claude", "brew", "darwin"), {
    command: "brew",
    args: ["upgrade", "claude-code"],
  });

  assert.deepEqual(buildCliUpgradeCommand("codex", "winget", "win32"), {
    command: "winget",
    args: [
      "upgrade",
      "--id",
      "OpenAI.Codex",
      "--accept-source-agreements",
      "--accept-package-agreements",
    ],
  });
});

test("buildCliInstallCommand bootstraps a provider package through npm mirror", () => {
  assert.deepEqual(buildCliInstallCommand("claude", "win32"), {
    command: "npm.cmd",
    args: ["install", "-g", "@anthropic-ai/claude-code@latest", "--registry", "https://registry.npmmirror.com"],
    env: {
      ...process.env,
      npm_config_registry: "https://registry.npmmirror.com",
      NPM_CONFIG_REGISTRY: "https://registry.npmmirror.com",
    },
  });
});

test("formatCliUpgradeCommandPreview quotes whitespace safely", () => {
  assert.equal(
    formatCliUpgradeCommandPreview({
      command: "powershell.exe",
      args: ["-File", "C:/Program Files/Agent Flow/upgrade.ps1"],
    }),
    'powershell.exe -File "C:/Program Files/Agent Flow/upgrade.ps1"',
  );
});
