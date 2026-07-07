const test = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldReuseExistingTokenAfterRefreshFailure,
} = require("../dist/src/auth-token-refresh-policy.js");

test("token refresh failure reuses existing token only for non-forced refreshes", () => {
  assert.equal(
    shouldReuseExistingTokenAfterRefreshFailure({
      force: false,
      hasUsableExistingToken: true,
    }),
    true,
  );
  assert.equal(
    shouldReuseExistingTokenAfterRefreshFailure({
      force: true,
      hasUsableExistingToken: true,
    }),
    false,
  );
  assert.equal(
    shouldReuseExistingTokenAfterRefreshFailure({
      force: false,
      hasUsableExistingToken: false,
    }),
    false,
  );
});
