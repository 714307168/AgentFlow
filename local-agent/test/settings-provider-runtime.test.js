const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getProviderAvailability,
  getProviderCapabilityEntries,
  getProviderOptions,
  getFirstSelectableProvider,
  getInstallMethodLabel,
  getProviderRuntimeMode,
  hasProviderApiFallback,
} = require("../renderer/settings-provider-runtime.js");

test("getProviderAvailability returns unknown when runtime detection has not populated the provider yet", () => {
  assert.equal(getProviderAvailability(null, "claude"), "unknown");
  assert.equal(getProviderAvailability({}, "codex"), "unknown");
});

test("getProviderOptions disables only missing providers that are not already selected", () => {
  const options = getProviderOptions({
    claude: { installed: true },
    codex: { installed: false },
  }, "claude", null);

  assert.deepEqual(options, [
    {
      id: "claude",
      label: "Claude Code",
      availability: "installed",
      selected: true,
      disabled: false,
    },
    {
      id: "codex",
      label: "OpenAI Codex",
      availability: "missing",
      selected: false,
      disabled: true,
    },
  ]);
});

test("getProviderOptions keeps the current missing provider selectable so existing bindings remain visible", () => {
  const options = getProviderOptions({
    claude: { installed: true },
    codex: { installed: false },
  }, "codex", null);

  assert.equal(options[1].selected, true);
  assert.equal(options[1].disabled, false);
});

test("getFirstSelectableProvider falls back to the first installed provider when the preferred one is missing", () => {
  assert.equal(getFirstSelectableProvider({
    claude: { installed: true },
    codex: { installed: false },
  }, "codex", null), "claude");
});

test("getProviderAvailability reports fallback when API credentials are usable without a local CLI", () => {
  assert.equal(getProviderAvailability({
    codex: { installed: false },
  }, "codex", {
    openaiApiKey: "sk-test",
  }), "fallback");
});

test("getProviderOptions keeps API-fallback providers selectable", () => {
  const options = getProviderOptions({
    claude: { installed: true },
    codex: {
      installed: false,
      capabilities: {
        promptExecution: false,
      },
    },
  }, "claude", {
    openaiApiKey: "sk-test",
  });

  assert.equal(options[1].availability, "fallback");
  assert.equal(options[1].disabled, false);
});

test("getProviderAvailability reports degraded when a CLI is installed but cannot execute prompts and no fallback exists", () => {
  assert.equal(getProviderAvailability({
    codex: {
      installed: true,
      capabilities: {
        promptExecution: false,
      },
    },
  }, "codex", null), "degraded");
});

test("hasProviderApiFallback checks provider-specific API keys", () => {
  assert.equal(hasProviderApiFallback({ openaiApiKey: "sk-test" }, "codex"), true);
  assert.equal(hasProviderApiFallback({ anthropicApiKey: "ak-test" }, "claude"), true);
  assert.equal(hasProviderApiFallback({ openaiApiKey: " " }, "codex"), false);
});

test("getProviderRuntimeMode prefers a working local CLI and otherwise falls back to API credentials", () => {
  assert.equal(getProviderRuntimeMode({
    codex: {
      installed: true,
      capabilities: {
        promptExecution: true,
      },
    },
  }, { openaiApiKey: "sk-test" }, "codex"), "cli");

  assert.equal(getProviderRuntimeMode({
    codex: {
      installed: true,
      capabilities: {
        promptExecution: false,
      },
    },
  }, { openaiApiKey: "sk-test" }, "codex"), "sdk");

  assert.equal(getProviderRuntimeMode({
    codex: {
      installed: false,
      capabilities: {
        promptExecution: false,
      },
    },
  }, { openaiApiKey: "" }, "codex"), "unavailable");
});

test("getInstallMethodLabel formats known install sources", () => {
  assert.equal(getInstallMethodLabel("npm"), "npm");
  assert.equal(getInstallMethodLabel("brew"), "Homebrew");
  assert.equal(getInstallMethodLabel("scoop"), "Scoop");
  assert.equal(getInstallMethodLabel("winget"), "Winget");
  assert.equal(getInstallMethodLabel("unknown"), null);
});

test("getProviderCapabilityEntries returns provider-specific capability keys", () => {
  assert.deepEqual(
    getProviderCapabilityEntries("claude", {
      capabilities: {
        promptExecution: true,
        resumeConversation: false,
        versionCommand: true,
        nativeTools: true,
      },
    }).map((entry) => entry.key),
    ["promptExecution", "resumeConversation", "versionCommand", "nativeTools"],
  );

  assert.equal(
    getProviderCapabilityEntries("codex", {
      capabilities: {
        promptExecution: true,
        resumeConversation: true,
        webSearch: true,
      },
    }).length,
    9,
  );
});
