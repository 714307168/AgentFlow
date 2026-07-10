const test = require("node:test");
const assert = require("node:assert/strict");

const { listConfiguredModelOptions } = require("../dist/src/model-options.js");

test("listConfiguredModelOptions lists built-in OpenAI-compatible models using env keys without upstream fetch", async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("model list should not call upstream fetch");
  };

  try {
    const options = await listConfiguredModelOptions({
      modelProviderProfiles: [{
        id: "deepseek",
        name: "DeepSeek",
        protocol: "openai",
        apiKey: "",
        baseUrl: "https://api.deepseek.com",
        defaultModel: "deepseek-chat",
        enabled: true,
      }],
    }, {
      DEEPSEEK_API_KEY: "sk-env",
    });

    assert.equal(options.length, 1);
    assert.equal(options[0].configured, true);
    assert.equal(options[0].credentialSource, "env");
    assert.deepEqual(options[0].models, ["deepseek-chat", "deepseek-reasoner"]);
  } finally {
    global.fetch = previousFetch;
  }
});

test("listConfiguredModelOptions merges configured defaults with built-in provider models", async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("model list should not call upstream fetch");
  };

  try {
    const options = await listConfiguredModelOptions({
      modelProviderProfiles: [{
        id: "anthropic",
        name: "Anthropic Claude",
        protocol: "anthropic",
        apiKey: "sk-config",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-custom",
        enabled: true,
      }],
    });

    assert.equal(options.length, 1);
    assert.equal(options[0].configured, true);
    assert.equal(options[0].credentialSource, "config");
    assert.equal(options[0].error, undefined);
    assert.deepEqual(options[0].models, [
      "claude-custom",
      "claude-3-7-sonnet-latest",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-opus-latest",
    ]);
  } finally {
    global.fetch = previousFetch;
  }
});

test("listConfiguredModelOptions marks missing provider credentials explicitly", async () => {
  const options = await listConfiguredModelOptions({
    modelProviderProfiles: [{
      id: "openai",
      name: "OpenAI",
      protocol: "openai",
      apiKey: "",
      baseUrl: "https://api.openai.com",
      defaultModel: "gpt-5.4",
      enabled: true,
    }],
  }, {});

  assert.equal(options.length, 1);
  assert.equal(options[0].configured, false);
  assert.equal(options[0].credentialSource, "none");
  assert.deepEqual(options[0].models.slice(0, 5), ["gpt-5.4", "gpt-5.6", "gpt-5.5", "gpt-5.4-mini", "gpt-5-codex"]);
});

test("listConfiguredModelOptions exposes current Codex model choices without upstream lookup", async () => {
  const options = await listConfiguredModelOptions({
    modelProviderProfiles: [{
      id: "openai",
      name: "OpenAI",
      protocol: "openai",
      apiKey: "sk-config",
      baseUrl: "https://api.openai.com",
      defaultModel: "gpt-5.6",
      enabled: true,
    }],
  }, {});

  assert.equal(options.length, 1);
  assert.equal(options[0].configured, true);
  assert.equal(options[0].credentialSource, "config");
  assert.deepEqual(options[0].models.slice(0, 5), ["gpt-5.6", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5-codex"]);
});
