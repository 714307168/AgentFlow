const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCliUpgradePlan,
  normalizeCliVersionOutput,
  getCliProviderCommand,
} = require("../dist/src/cli-runtime-status.js");
const {
  compareSemanticVersions,
  extractSemanticVersion,
  shouldRecommendVersionUpgrade,
} = require("../dist/src/cli-version.js");

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
    latestVersion: null,
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
    latestVersion: null,
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

test("compareSemanticVersions sorts semantic versions correctly", () => {
  assert.equal(compareSemanticVersions("1.2.3", "1.2.4"), -1);
  assert.equal(compareSemanticVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareSemanticVersions("1.3.0", "1.2.9"), 1);
});

test("shouldRecommendVersionUpgrade only flags newer detected releases", () => {
  assert.equal(shouldRecommendVersionUpgrade("codex-cli 0.118.0", "0.119.0"), true);
  assert.equal(shouldRecommendVersionUpgrade("codex-cli 0.118.0", "0.118.0"), false);
  assert.equal(shouldRecommendVersionUpgrade(null, "0.119.0"), true);
});

test("buildCliUpgradePlan recommends upgrading when a newer version is available", () => {
  const plan = buildCliUpgradePlan({
    provider: "codex",
    version: "codex-cli 0.118.0",
    latestVersion: "0.119.0",
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
    },
  });

  assert.equal(plan.available, true);
  assert.equal(plan.latestVersion, "0.119.0");
  assert.match(plan.reason || "", /0\.118\.0\s*->\s*0\.119\.0/i);
});
