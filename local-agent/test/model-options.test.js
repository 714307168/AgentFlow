const test = require("node:test");
const assert = require("node:assert/strict");

const { listConfiguredModelOptions } = require("../dist/src/model-options.js");

test("listConfiguredModelOptions loads OpenAI-compatible models using env keys", async () => {
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { id: "deepseek-chat" },
          { id: "deepseek-reasoner" },
        ],
      }),
    };
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
    assert.deepEqual(options[0].models, ["deepseek-chat", "deepseek-reasoner"]);
    assert.equal(calls[0].url, "https://api.deepseek.com/v1/models");
    assert.equal(calls[0].init.headers.Authorization, "Bearer sk-env");
  } finally {
    global.fetch = previousFetch;
  }
});

test("listConfiguredModelOptions falls back to configured default when model API fails", async () => {
  const previousFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  });

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
    assert.equal(options[0].error, "HTTP 401");
    assert.deepEqual(options[0].models, ["claude-custom", "claude-3-7-sonnet-latest"]);
  } finally {
    global.fetch = previousFetch;
  }
});
