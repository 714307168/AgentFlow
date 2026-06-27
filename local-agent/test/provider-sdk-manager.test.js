const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const testUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-provider-sdk-test-"));
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath() {
          return testUserDataPath;
        },
        setPath() {},
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  getProviderSdkPackageName,
  getProviderSdkPackageManagerCommand,
  resolveManagedProviderSdkInstallRoot,
  buildProviderSdkInstallCommand,
  formatProviderSdkInstallCommand,
  maintainManagedProviderSdk,
} = require("../dist/src/provider-sdk-manager.js");

test("getProviderSdkPackageName maps providers to managed SDK packages", () => {
  assert.equal(getProviderSdkPackageName("codex"), "openai");
  assert.equal(getProviderSdkPackageName("claude"), "@anthropic-ai/sdk");
});

test("getProviderSdkPackageManagerCommand resolves platform npm command", () => {
  assert.equal(getProviderSdkPackageManagerCommand("win32"), "npm.cmd");
  assert.equal(getProviderSdkPackageManagerCommand("linux"), "npm");
});

test("resolveManagedProviderSdkInstallRoot nests packages under provider-sdk-runtime", () => {
  const root = resolveManagedProviderSdkInstallRoot("codex", "D:/AgentFlow/data");
  assert.equal(root, path.join("D:/AgentFlow/data", "provider-sdk-runtime", "codex"));
});

test("buildProviderSdkInstallCommand installs latest package through the domestic npm mirror", () => {
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-provider-sdk-install-"));
  const command = buildProviderSdkInstallCommand("claude", installRoot, "win32");
  assert.deepEqual(command, {
    command: "npm.cmd",
    args: [
      "install",
      "--no-save",
      "--prefix",
      installRoot,
      "@anthropic-ai/sdk@latest",
      "--registry",
      "https://registry.npmmirror.com",
    ],
    env: {
      ...process.env,
      npm_config_registry: "https://registry.npmmirror.com",
      NPM_CONFIG_REGISTRY: "https://registry.npmmirror.com",
    },
  });
});

test("formatProviderSdkInstallCommand quotes whitespace safely", () => {
  assert.equal(
    formatProviderSdkInstallCommand({
      command: "npm.cmd",
      args: ["install", "--prefix", "C:/Program Files/Agent Flow/sdk-runtime", "openai@latest"],
      env: process.env,
    }),
    'npm.cmd install --prefix "C:/Program Files/Agent Flow/sdk-runtime" openai@latest',
  );
});

test("maintainManagedProviderSdk skips npm install when package manager is unavailable and HTTP fallback is configured", async () => {
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-provider-sdk-no-npm-"));
  const result = await maintainManagedProviderSdk("codex", installRoot, {
    sdkConfigured: true,
    packageManagerAvailable: false,
  });

  assert.equal(result.success, true);
  assert.equal(result.skipped, true);
  assert.equal(result.fallbackAvailable, true);
  assert.match(result.output, /HTTP API runtime/i);
});

test("maintainManagedProviderSdk reports unavailable when npm and API credentials are both missing", async () => {
  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-provider-sdk-no-runtime-"));
  const result = await maintainManagedProviderSdk("claude", installRoot, {
    sdkConfigured: false,
    packageManagerAvailable: false,
  });

  assert.equal(result.success, false);
  assert.equal(result.skipped, true);
  assert.equal(result.fallbackAvailable, false);
  assert.match(result.error, /npm is not available/i);
});
