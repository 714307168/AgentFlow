const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
