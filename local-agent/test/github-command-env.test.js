const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGitHubCommandEnvironment } = require("../dist/src/github-command-env.js");

test("buildGitHubCommandEnvironment returns empty env without a token", () => {
  assert.deepEqual(buildGitHubCommandEnvironment(""), {});
  assert.deepEqual(buildGitHubCommandEnvironment(null), {});
});

test("buildGitHubCommandEnvironment injects non-interactive GitHub auth env when a token is present", () => {
  const env = buildGitHubCommandEnvironment("ghp_token/with spaces");
  assert.equal(env.GITHUB_TOKEN, "ghp_token/with spaces");
  assert.equal(env.GH_TOKEN, "ghp_token/with spaces");
  assert.equal(env.GCM_INTERACTIVE, "never");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GIT_CONFIG_COUNT, "2");
  assert.equal(
    env.GIT_CONFIG_KEY_0,
    "url.https://x-access-token:ghp_token%2Fwith%20spaces@github.com/.insteadof",
  );
  assert.equal(env.GIT_CONFIG_VALUE_0, "https://github.com/");
  assert.equal(
    env.GIT_CONFIG_KEY_1,
    "url.https://x-access-token:ghp_token%2Fwith%20spaces@www.github.com/.insteadof",
  );
  assert.equal(env.GIT_CONFIG_VALUE_1, "https://www.github.com/");
});
