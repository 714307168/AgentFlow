const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const testUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-provider-sdk-runtime-test-"));
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath() {
          return testUserDataPath;
        },
        setPath() {},
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  executeProviderSdkRun,
  generateProviderSdkImage,
} = require("../dist/src/provider-sdk.js");

test("generateProviderSdkImage rejects unsupported providers", async () => {
  await assert.rejects(
    generateProviderSdkImage({
      provider: "claude",
      config: {
        apiKey: "test-key",
        baseUrl: "https://api.anthropic.com",
        defaultModel: "claude-3-7-sonnet-latest",
      },
      model: null,
      prompt: "create an icon",
    }),
    /Image generation is currently available only for OpenAI-compatible project providers/,
  );
});

test("executeProviderSdkRun falls back to the HTTP chat endpoint when no managed SDK is installed", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/chat/completions");
    assert.equal(init?.method, "POST");
    assert.equal(init?.headers?.Authorization, "Bearer test-key");
    const payload = JSON.parse(String(init?.body || "{}"));
    assert.equal(payload.model, "gpt-4o-mini");
    assert.equal(payload.messages[0].role, "system");
    assert.equal(payload.messages[0].content, "Follow project rules.");
    assert.equal(payload.messages[1].role, "user");

    return {
      ok: true,
      async json() {
        return {
          model: "gpt-4o-mini",
          choices: [{
            message: {
              content: "HTTP fallback response",
            },
          }],
        };
      },
    };
  };

  try {
    const result = await executeProviderSdkRun({
      provider: "codex",
      config: {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com",
        defaultModel: "gpt-4o-mini",
      },
      model: null,
      prompt: "hello",
      projectPrompt: "Follow project rules.",
    });

    assert.equal(result.text, "HTTP fallback response");
    assert.equal(result.model, "gpt-4o-mini");
  } finally {
    global.fetch = originalFetch;
  }
});

test("executeProviderSdkRun does not append duplicate v1 when the base URL already includes it", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(String(input), "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    assert.equal(init?.method, "POST");
    return {
      ok: true,
      async json() {
        return {
          model: "qwen-plus",
          choices: [{
            message: {
              content: "Qwen response",
            },
          }],
        };
      },
    };
  };

  try {
    const result = await executeProviderSdkRun({
      provider: "codex",
      config: {
        apiKey: "test-key",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        defaultModel: "qwen-plus",
      },
      model: null,
      prompt: "hello",
    });

    assert.equal(result.text, "Qwen response");
  } finally {
    global.fetch = originalFetch;
  }
});

test("generateProviderSdkImage falls back to the HTTP image endpoint when no managed SDK is installed", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/images/generations");
    assert.equal(init?.method, "POST");
    const payload = JSON.parse(String(init?.body || "{}"));
    assert.equal(payload.model, "gpt-image-1");
    assert.equal(payload.prompt, "create a launch illustration");
    return {
      ok: true,
      async json() {
        return {
          model: "gpt-image-1",
          data: [{
            b64_json: Buffer.from("png-bytes").toString("base64"),
            revised_prompt: "Create a launch illustration",
          }],
        };
      },
    };
  };

  try {
    const result = await generateProviderSdkImage({
      provider: "codex",
      config: {
        apiKey: "test-key",
        baseUrl: "https://api.openai.com",
        defaultModel: "gpt-image-1",
      },
      model: "gpt-image-1",
      prompt: "create a launch illustration",
    });

    assert.equal(result.model, "gpt-image-1");
    assert.equal(result.mimeType, "image/png");
    assert.equal(result.fileExtension, ".png");
    assert.equal(result.revisedPrompt, "Create a launch illustration");
    assert.equal(result.bytes.equals(Buffer.from("png-bytes")), true);
  } finally {
    global.fetch = originalFetch;
  }
});
