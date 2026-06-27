const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldAutoMaintainManagedProviderSdk,
  shouldPrepareManagedProviderSdkRuntime,
} = require("../dist/src/provider-runtime-maintenance.js");

function createCliStatus(overrides = {}) {
  return {
    provider: "codex",
    installed: true,
    capabilities: {
      promptExecution: true,
    },
    ...overrides,
  };
}

function createSdkStatus(overrides = {}) {
  return {
    provider: "codex",
    packageName: "openai",
    installed: false,
    version: null,
    latestVersion: null,
    upgradeAvailable: false,
    installRoot: "D:/AgentFlow/data/provider-sdk-runtime/codex",
    packageJsonPath: "D:/AgentFlow/data/provider-sdk-runtime/codex/node_modules/openai/package.json",
    resolvedModulePath: null,
    detail: "Managed SDK is not installed yet.",
    checkedAt: Date.now(),
    ...overrides,
  };
}

test("provider SDK runtime is prepared when local CLI is missing", () => {
  assert.equal(shouldPrepareManagedProviderSdkRuntime({
    cliStatus: createCliStatus({ installed: false }),
    sdkConfigured: false,
  }), true);
});

test("provider SDK runtime is prepared when CLI cannot execute prompts and API fallback is configured", () => {
  assert.equal(shouldPrepareManagedProviderSdkRuntime({
    cliStatus: createCliStatus({
      capabilities: {
        promptExecution: false,
      },
    }),
    sdkConfigured: true,
  }), true);
});

test("provider SDK runtime is not prepared when a working CLI exists", () => {
  assert.equal(shouldPrepareManagedProviderSdkRuntime({
    cliStatus: createCliStatus(),
    sdkConfigured: true,
  }), false);
});

test("managed provider SDK auto maintenance installs or upgrades only when SDK runtime is needed", () => {
  assert.equal(shouldAutoMaintainManagedProviderSdk({
    cliStatus: createCliStatus({ installed: false }),
    sdkConfigured: false,
    sdkStatus: createSdkStatus({ installed: false }),
  }), true);

  assert.equal(shouldAutoMaintainManagedProviderSdk({
    cliStatus: createCliStatus({ installed: false }),
    sdkConfigured: false,
    sdkStatus: createSdkStatus({ installed: true, version: "1.0.0", upgradeAvailable: true }),
  }), true);

  assert.equal(shouldAutoMaintainManagedProviderSdk({
    cliStatus: createCliStatus(),
    sdkConfigured: true,
    sdkStatus: createSdkStatus({ installed: false }),
  }), false);
});
