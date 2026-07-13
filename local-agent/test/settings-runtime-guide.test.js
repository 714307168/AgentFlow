const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getProviderInstallCommand,
  getProviderRuntimeGuide,
} = require("../renderer/settings-runtime-guide.js");

test("Codex runtime guidance offers a repair command when exec support is unavailable", () => {
  assert.deepEqual(getProviderRuntimeGuide("codex", {
    installed: true,
    capabilities: { promptExecution: false },
    upgrade: { commandPreview: "npm install -g @openai/codex@latest" },
  }, false), {
    kind: "repair",
    provider: "codex",
    command: "npm install -g @openai/codex@latest",
  });
});

test("Codex runtime guidance offers installation when the CLI is absent", () => {
  assert.deepEqual(getProviderRuntimeGuide("codex", { installed: false }, false), {
    kind: "install",
    provider: "codex",
    command: "npm install -g @openai/codex@latest",
  });
  assert.equal(getProviderInstallCommand("claude"), "npm install -g @anthropic-ai/claude-code@latest");
});

test("runtime guidance stays out of the way when an API fallback is ready", () => {
  assert.equal(getProviderRuntimeGuide("codex", {
    installed: true,
    capabilities: { promptExecution: false },
  }, true), null);
});
