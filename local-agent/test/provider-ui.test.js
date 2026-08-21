const test = require("node:test");
const assert = require("node:assert/strict");

const providerUi = require("../renderer/provider-ui.js");
const clientCapabilities = require("../renderer/client-capabilities.js");

test("provider ui exposes shared labels and capability labels", () => {
  assert.equal(providerUi.getProviderLabel("codex"), "OpenAI Codex");
  assert.equal(providerUi.getProviderLabel("claude"), "Claude Code");
  assert.equal(providerUi.getProviderCapabilityLabel("codex", "nativeTools", "en"), "Built-in Tools");
  assert.equal(providerUi.getProviderCapabilityLabel("claude", "nativeTools", "zh"), "原生工具");
});

test("provider ui exposes model provider presets", () => {
  const presetIds = providerUi.listModelProviderPresets().map((preset) => preset.id);
  assert.equal(presetIds.includes("deepseek"), true);
  assert.equal(presetIds.includes("zhipu"), true);
  assert.equal(presetIds.includes("hunyuan"), true);
  assert.equal(presetIds.includes("aliyun-qwen"), true);
  assert.equal(
    providerUi.listModelProviderPresets().find((preset) => preset.id === "anthropic")?.defaultModel,
    "claude-sonnet-4-5",
  );
});

test("desktop client capabilities expose attachment and gateway support", () => {
  assert.equal(clientCapabilities.supportsDesktopCapability("localCommandGateway"), true);
  assert.equal(clientCapabilities.supportsDesktopCapability("messageAttachmentImages"), true);
  assert.equal(clientCapabilities.supportsDesktopCapability("clipboardImagePaste"), true);
});
