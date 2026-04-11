const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getProviderAvailability,
  getProviderOptions,
  getFirstSelectableProvider,
} = require("../renderer/settings-provider-runtime.js");

test("getProviderAvailability returns unknown when runtime detection has not populated the provider yet", () => {
  assert.equal(getProviderAvailability(null, "claude"), "unknown");
  assert.equal(getProviderAvailability({}, "codex"), "unknown");
});

test("getProviderOptions disables only missing providers that are not already selected", () => {
  const options = getProviderOptions({
    claude: { installed: true },
    codex: { installed: false },
  }, "claude");

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
  }, "codex");

  assert.equal(options[1].selected, true);
  assert.equal(options[1].disabled, false);
});

test("getFirstSelectableProvider falls back to the first installed provider when the preferred one is missing", () => {
  assert.equal(getFirstSelectableProvider({
    claude: { installed: true },
    codex: { installed: false },
  }, "codex"), "claude");
});
