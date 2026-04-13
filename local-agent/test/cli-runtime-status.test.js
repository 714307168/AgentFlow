const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCliUpgradePlan,
  extractSemanticVersion,
  getCliProviderCommand,
  normalizeCliVersionOutput,
} = require("../dist/src/cli-runtime-status.js");

test("getCliProviderCommand maps providers to platform-specific binaries", () => {
  assert.equal(getCliProviderCommand("codex", "win32"), "codex.cmd");
  assert.equal(getCliProviderCommand("claude", "win32"), "claude.cmd");
  assert.equal(getCliProviderCommand("codex", "linux"), "codex");
  assert.equal(getCliProviderCommand("claude", "darwin"), "claude");
});

test("normalizeCliVersionOutput returns the first non-empty line from stdout or stderr", () => {
  assert.equal(normalizeCliVersionOutput("\n codex-cli 0.118.0 \n", ""), "codex-cli 0.118.0");
  assert.equal(normalizeCliVersionOutput("", "\nclaude-code 1.0.0\nmore"), "claude-code 1.0.0");
  assert.equal(normalizeCliVersionOutput(" \n ", " \n "), null);
});

test("extractSemanticVersion returns the first semantic version in a CLI banner", () => {
  assert.equal(extractSemanticVersion("codex-cli 0.118.0"), "0.118.0");
  assert.equal(extractSemanticVersion("Claude Code v1.2.3-beta"), "1.2.3");
  assert.equal(extractSemanticVersion("no version here"), null);
});

test("buildCliUpgradePlan recommends upgrading Codex when required capabilities are missing", () => {
  const plan = buildCliUpgradePlan({
    provider: "codex",
    version: "codex-cli 0.118.0",
    installMethod: "npm",
    capabilities: {
      promptExecution: true,
      resumeConversation: false,
      webSearch: false,
      reviewCommand: true,
      featuresCommand: true,
      mcpCommand: true,
      completionCommand: true,
      versionCommand: true,
      nativeTools: true,
    },
  });

  assert.equal(plan.available, true);
  assert.match(plan.reason || "", /conversation resume/i);
  assert.match(plan.commandPreview || "", /npm/i);
});

test("buildCliUpgradePlan stays quiet when all required capabilities are present", () => {
  const plan = buildCliUpgradePlan({
    provider: "claude",
    version: "claude-code 1.0.0",
    installMethod: "npm",
    capabilities: {
      promptExecution: true,
      resumeConversation: true,
      webSearch: false,
      reviewCommand: false,
      featuresCommand: false,
      mcpCommand: false,
      completionCommand: false,
      versionCommand: true,
      nativeTools: true,
    },
  });

  assert.equal(plan.available, false);
  assert.equal(plan.reason, null);
});
