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
      "claude-opus-4-5",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
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
      defaultModel: "gpt-5.6-terra",
      enabled: true,
    }],
  }, {});

  assert.equal(options.length, 1);
  assert.equal(options[0].configured, false);
  assert.equal(options[0].credentialSource, "none");
  assert.deepEqual(options[0].models.slice(0, 7), [
    "gpt-5.6-terra",
    "gpt-5.6-sol",
    "gpt-5.6-luna",
    "gpt-5.6",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
  ]);
});

test("listConfiguredModelOptions exposes current Codex model choices without upstream lookup", async () => {
  const options = await listConfiguredModelOptions({
    modelProviderProfiles: [{
      id: "openai",
      name: "OpenAI",
      protocol: "openai",
      apiKey: "sk-config",
      baseUrl: "https://api.openai.com",
      defaultModel: "gpt-5.6-terra",
      enabled: true,
    }],
  }, {});

  assert.equal(options.length, 1);
  assert.equal(options[0].configured, true);
  assert.equal(options[0].credentialSource, "config");
  assert.deepEqual(options[0].models.slice(0, 7), [
    "gpt-5.6-terra",
    "gpt-5.6-sol",
    "gpt-5.6-luna",
    "gpt-5.6",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
  ]);
});

test("listConfiguredModelOptions refreshes Anthropic models with the configured base URL and key", async () => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), headers: init.headers });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          data: [
            { id: "claude-opus-4-5-20251101" },
            { id: "claude-sonnet-4-5-20250929" },
            { id: "not-a-claude-model" },
          ],
          has_more: true,
          last_id: "claude-sonnet-4-5-20250929",
        };
      },
    };
  };

  const options = await listConfiguredModelOptions({
    modelProviderProfiles: [{
      id: "anthropic",
      name: "Anthropic Claude",
      protocol: "anthropic",
      apiKey: "test-key",
      baseUrl: "https://models.example.test/v1",
      defaultModel: "claude-sonnet-4-5",
      enabled: true,
    }],
  }, {}, { fetchRemote: true, fetch });

  assert.deepEqual(requests, [
    {
      url: "https://models.example.test/v1/models",
      headers: { "x-api-key": "test-key", "anthropic-version": "2023-06-01" },
    },
    {
      url: "https://models.example.test/v1/models?after_id=claude-sonnet-4-5-20250929",
      headers: { "x-api-key": "test-key", "anthropic-version": "2023-06-01" },
    },
  ]);
  assert.deepEqual(options[0].models.slice(0, 3), [
    "claude-sonnet-4-5",
    "claude-opus-4-5-20251101",
    "claude-sonnet-4-5-20250929",
  ]);
  assert.equal(options[0].models.includes("not-a-claude-model"), false);
});

test("listConfiguredModelOptions keeps local choices when a model endpoint fails", async () => {
  const options = await listConfiguredModelOptions({
    modelProviderProfiles: [{
      id: "anthropic",
      name: "Anthropic Claude",
      protocol: "anthropic",
      apiKey: "test-key",
      baseUrl: "https://models.example.test",
      defaultModel: "claude-sonnet-4-5",
      enabled: true,
    }],
  }, {}, {
    fetchRemote: true,
    fetch: async () => ({ ok: false, status: 401 }),
  });

  assert.equal(options[0].error, "Model endpoint returned HTTP 401.");
  assert.equal(options[0].models.includes("claude-sonnet-4-5"), true);
});
