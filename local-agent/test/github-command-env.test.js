const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGitHubCommandEnvironment } = require("../dist/src/github-command-env.js");

test("buildGitHubCommandEnvironment disables interactive Git auth even without a token", () => {
  const env = buildGitHubCommandEnvironment("");
  assert.equal(env.GCM_INTERACTIVE, "never");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GH_PROMPT_DISABLED, "1");
  assert.equal(env.GIT_CONFIG_COUNT, "3");
  assert.equal(env.GIT_CONFIG_KEY_0, "credential.helper");
  assert.equal(env.GIT_CONFIG_VALUE_0, "");
  assert.equal(env.GIT_CONFIG_KEY_1, "credential.interactive");
  assert.equal(env.GIT_CONFIG_VALUE_1, "never");
  assert.equal(env.GIT_CONFIG_KEY_2, "core.askPass");
  assert.equal(env.GIT_CONFIG_VALUE_2, "");
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.deepEqual(buildGitHubCommandEnvironment(null), env);
});

test("buildGitHubCommandEnvironment injects non-interactive GitHub auth env when a token is present", () => {
  const env = buildGitHubCommandEnvironment("ghp_token/with spaces");
  assert.equal(env.GITHUB_TOKEN, "ghp_token/with spaces");
  assert.equal(env.GH_TOKEN, "ghp_token/with spaces");
  assert.equal(env.GCM_INTERACTIVE, "never");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GH_PROMPT_DISABLED, "1");
  assert.equal(env.GIT_CONFIG_COUNT, "5");
  assert.equal(
    env.GIT_CONFIG_KEY_3,
    "url.https://x-access-token:ghp_token%2Fwith%20spaces@github.com/.insteadof",
  );
  assert.equal(env.GIT_CONFIG_VALUE_3, "https://github.com/");
  assert.equal(
    env.GIT_CONFIG_KEY_4,
    "url.https://x-access-token:ghp_token%2Fwith%20spaces@www.github.com/.insteadof",
  );
  assert.equal(env.GIT_CONFIG_VALUE_4, "https://www.github.com/");
});
