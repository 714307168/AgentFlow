const test = require("node:test");
const assert = require("node:assert/strict");

const {
  EMPTY_PROVIDER_CAPABILITIES,
  buildProviderEnvironment,
  createProviderNativeCliCapabilities,
  getCliProviderCommand,
  getProviderCapabilityKeys,
  getProviderDefaultSdkBaseUrl,
  getProviderDefaultSdkModel,
  getProviderInstallTargets,
  getProviderLabel,
  getProviderSdkConfigValue,
  getProviderUpgradeMissingCapabilityLabels,
  hasProviderApiFallback,
  listModelProviderPresets,
  listRegisteredProviders,
  normalizeActiveModelProviderProfileMap,
  normalizeModelProviderProfiles,
  normalizeCliProvider,
} = require("../dist/src/provider-registry.js");

test("listRegisteredProviders and normalizeCliProvider expose the supported provider ids", () => {
  assert.deepEqual(listRegisteredProviders(), ["claude", "codex"]);
  assert.equal(normalizeCliProvider("codex"), "codex");
  assert.equal(normalizeCliProvider("unknown", "codex"), "codex");
});

test("provider labels, commands, install targets, and sdk defaults come from the shared registry", () => {
  assert.equal(getProviderLabel("claude"), "Claude Code");
  assert.equal(getProviderLabel("codex"), "OpenAI Codex");
  assert.equal(getCliProviderCommand("codex", "win32"), "codex.cmd");
  assert.equal(getCliProviderCommand("claude", "linux"), "claude");
  assert.equal(getProviderInstallTargets("claude").winget, "Anthropic.ClaudeCode");
  assert.equal(getProviderInstallTargets("codex").npm, "@openai/codex@latest");
  assert.equal(getProviderDefaultSdkBaseUrl("claude"), "https://api.anthropic.com");
  assert.equal(getProviderDefaultSdkModel("codex"), "gpt-5.6-terra");
});

test("provider capability helpers stay provider-specific", () => {
  assert.deepEqual(
    getProviderCapabilityKeys("claude"),
    ["promptExecution", "resumeConversation", "versionCommand", "nativeTools"],
  );
  assert.equal(getProviderCapabilityKeys("codex").length, 9);

  assert.deepEqual(createProviderNativeCliCapabilities("claude"), {
    ...EMPTY_PROVIDER_CAPABILITIES,
    promptExecution: true,
    resumeConversation: true,
    versionCommand: true,
    nativeTools: true,
  });

  assert.deepEqual(
    getProviderUpgradeMissingCapabilityLabels("codex", {
      ...createProviderNativeCliCapabilities("codex"),
      webSearch: false,
    }),
    ["web search flag"],
  );
});

test("provider sdk config and environment helpers reuse registry config keys", () => {
  const config = {
    openaiApiKey: "sk-openai",
    openaiBaseUrl: "https://openai.example.com",
    openaiDefaultModel: "gpt-custom",
    anthropicApiKey: "sk-anthropic",
    anthropicBaseUrl: "https://anthropic.example.com",
    anthropicDefaultModel: "claude-custom",
  };

  assert.equal(getProviderSdkConfigValue(config, "codex", "apiKey"), "sk-openai");
  assert.equal(getProviderSdkConfigValue(config, "claude", "baseUrl"), "https://anthropic.example.com");
  assert.equal(getProviderSdkConfigValue(config, "claude", "defaultModel"), "claude-custom");
  assert.equal(hasProviderApiFallback(config, "codex"), true);
  assert.equal(hasProviderApiFallback({ openaiApiKey: "   " }, "codex"), false);

  assert.deepEqual(buildProviderEnvironment(config, "claude", { GITHUB_TOKEN: "gh-token" }), {
    GITHUB_TOKEN: "gh-token",
    ANTHROPIC_API_KEY: "sk-anthropic",
    ANTHROPIC_AUTH_TOKEN: "sk-anthropic",
    ANTHROPIC_BASE_URL: "https://anthropic.example.com",
  });

  assert.deepEqual(buildProviderEnvironment(config, "codex"), {
    OPENAI_API_KEY: "sk-openai",
    OPENAI_BASE_URL: "https://openai.example.com",
  });
});

test("model provider profiles override legacy sdk config through the active profile", () => {
  const profiles = normalizeModelProviderProfiles([
    {
      id: "deepseek",
      name: "DeepSeek",
      protocol: "openai",
      apiKey: "sk-deepseek",
      baseUrl: "https://api.deepseek.com",
      defaultModel: "deepseek-chat",
    },
    {
      id: "anthropic",
      name: "Anthropic",
      protocol: "anthropic",
      apiKey: "sk-ant",
      baseUrl: "https://api.anthropic.com",
      defaultModel: "claude-custom",
    },
  ]);
  const activeMap = normalizeActiveModelProviderProfileMap({ openai: "deepseek" }, profiles);
  const config = {
    openaiApiKey: "legacy-openai",
    openaiBaseUrl: "https://legacy.example.com",
    modelProviderProfiles: profiles,
    activeModelProviderProfileByProtocol: activeMap,
  };

  assert.equal(getProviderSdkConfigValue(config, "codex", "apiKey"), "sk-deepseek");
  assert.equal(getProviderSdkConfigValue(config, "codex", "baseUrl"), "https://api.deepseek.com");
  assert.equal(getProviderSdkConfigValue(config, "codex", "defaultModel"), "deepseek-chat");
  assert.equal(hasProviderApiFallback(config, "codex"), true);
  assert.deepEqual(buildProviderEnvironment(config, "codex"), {
    OPENAI_API_KEY: "sk-deepseek",
    OPENAI_BASE_URL: "https://api.deepseek.com",
  });
});

test("model provider presets include domestic OpenAI-compatible providers", () => {
  const presetIds = listModelProviderPresets().map((preset) => preset.id);
  assert.equal(presetIds.includes("deepseek"), true);
  assert.equal(presetIds.includes("zhipu"), true);
  assert.equal(presetIds.includes("minimax-mimo"), true);
  assert.equal(presetIds.includes("hunyuan"), true);
  assert.equal(presetIds.includes("aliyun-qwen"), true);
});
