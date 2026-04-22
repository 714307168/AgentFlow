const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_NPM_REGISTRY,
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

test("resolvePreferredNpmRegistry falls back to default domestic mirror", () => {
  assert.equal(resolvePreferredNpmRegistry({}), DEFAULT_NPM_REGISTRY);
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
