const test = require("node:test");
const assert = require("node:assert/strict");

const { selectProviderRuntime } = require("../dist/src/provider-runtime.js");

function createCliStatus(overrides = {}) {
  return {
    provider: "codex",
    command: "codex.cmd",
    installed: true,
    version: "codex-cli 0.0.1",
    detail: "Detected codex",
    checkedAt: Date.now(),
    resolvedPath: "C:/Program Files/nodejs/codex.cmd",
    installMethod: "npm",
    capabilities: {
      promptExecution: true,
      resumeConversation: true,
      webSearch: true,
      reviewCommand: true,
      featuresCommand: true,
      mcpCommand: true,
      completionCommand: true,
      versionCommand: true,
      nativeTools: true,
      ...(overrides.capabilities || {}),
    },
    upgrade: {
      available: false,
      required: false,
      installMethod: "npm",
      command: null,
      commandPreview: null,
      reason: null,
      latestVersion: null,
      ...(overrides.upgrade || {}),
    },
    ...overrides,
  };
}

test("selectProviderRuntime prefers a working CLI runtime", () => {
  const runtime = selectProviderRuntime({
    provider: "codex",
    cliStatus: createCliStatus(),
    sdkConfigured: true,
  });

  assert.equal(runtime.kind, "cli");
  assert.equal(runtime.capabilities.promptExecution, true);
});

test("selectProviderRuntime falls back to sdk when the installed CLI cannot execute prompts", () => {
  const runtime = selectProviderRuntime({
    provider: "codex",
    cliStatus: createCliStatus({
      capabilities: {
        promptExecution: false,
        resumeConversation: false,
        webSearch: false,
      },
    }),
    sdkConfigured: true,
  });

  assert.equal(runtime.kind, "sdk");
  assert.equal(runtime.capabilities.promptExecution, true);
  assert.match(runtime.detail, /fall back to the configured API runtime/i);
});

test("selectProviderRuntime reports unavailable when neither a working CLI nor sdk credentials exist", () => {
  const runtime = selectProviderRuntime({
    provider: "claude",
    cliStatus: createCliStatus({
      provider: "claude",
      command: "claude.cmd",
      capabilities: {
        promptExecution: false,
        resumeConversation: false,
        webSearch: false,
        reviewCommand: false,
        featuresCommand: false,
        mcpCommand: false,
        completionCommand: false,
        versionCommand: true,
        nativeTools: false,
      },
    }),
    sdkConfigured: false,
  });

  assert.equal(runtime.kind, "unavailable");
  assert.match(runtime.detail, /does not support prompt execution/i);
});
