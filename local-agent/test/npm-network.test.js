const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_NPM_REGISTRY,
  OFFICIAL_NPM_REGISTRY,
  isLikelyChinaEnvironment,
  appendNpmRegistryArgs,
  buildNpmCommandEnvironment,
  resolvePreferredNpmRegistry,
} = require("../dist/src/npm-network.js");

test("resolvePreferredNpmRegistry prefers explicit AgentFlow mirror", () => {
  assert.equal(resolvePreferredNpmRegistry({
    AGENTFLOW_NPM_REGISTRY: "https://registry.example.com/",
    npm_config_registry: "https://ignored.example.com",
  }), "https://registry.example.com");
});

test("resolvePreferredNpmRegistry uses the domestic mirror for China and the official registry elsewhere", () => {
  assert.equal(resolvePreferredNpmRegistry({}, "Asia/Shanghai"), DEFAULT_NPM_REGISTRY);
  assert.equal(resolvePreferredNpmRegistry({}, "America/Los_Angeles"), OFFICIAL_NPM_REGISTRY);
  assert.equal(resolvePreferredNpmRegistry({ AGENTFLOW_REGION: "cn" }, "UTC"), DEFAULT_NPM_REGISTRY);
  assert.equal(resolvePreferredNpmRegistry({ AGENTFLOW_REGION: "global" }, "Asia/Shanghai"), OFFICIAL_NPM_REGISTRY);
  assert.equal(isLikelyChinaEnvironment({ LANG: "zh_CN.UTF-8" }, "UTC"), true);
});

test("appendNpmRegistryArgs appends a registry flag", () => {
  assert.deepEqual(
    appendNpmRegistryArgs(["install", "-g", "@openai/codex@latest"], "https://registry.npmmirror.com"),
    ["install", "-g", "@openai/codex@latest", "--registry", "https://registry.npmmirror.com"],
  );
});

test("buildNpmCommandEnvironment injects both npm registry env keys", () => {
  const env = buildNpmCommandEnvironment({
    PATH: "C:/node",
  }, "https://registry.npmmirror.com");
  assert.equal(env.PATH, "C:/node");
  assert.equal(env.npm_config_registry, "https://registry.npmmirror.com");
  assert.equal(env.NPM_CONFIG_REGISTRY, "https://registry.npmmirror.com");
});
