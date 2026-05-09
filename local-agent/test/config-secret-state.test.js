const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CACHED_SECRET_PLACEHOLDER,
  hasStoredSecretValue,
  isCachedSecretPlaceholder,
  normalizeSecretInputForSave,
  toPublicSecretFieldValue,
} = require("../dist/src/config-secret-state.js");

test("toPublicSecretFieldValue returns the cached placeholder when a stored secret exists", () => {
  assert.equal(toPublicSecretFieldValue("enc:abc", ""), CACHED_SECRET_PLACEHOLDER);
  assert.equal(toPublicSecretFieldValue("", "decoded-secret"), CACHED_SECRET_PLACEHOLDER);
  assert.equal(toPublicSecretFieldValue("", ""), "");
});

test("normalizeSecretInputForSave preserves cached placeholders and keeps explicit edits", () => {
  assert.deepEqual(normalizeSecretInputForSave(CACHED_SECRET_PLACEHOLDER), {
    shouldUpdate: false,
    nextValue: "",
  });
  assert.deepEqual(normalizeSecretInputForSave(""), {
    shouldUpdate: true,
    nextValue: "",
  });
  assert.deepEqual(normalizeSecretInputForSave("next-secret"), {
    shouldUpdate: true,
    nextValue: "next-secret",
  });
});

test("secret placeholder helpers detect configured and cached values", () => {
  assert.equal(hasStoredSecretValue("plain:abc", ""), true);
  assert.equal(hasStoredSecretValue("", "decoded"), true);
  assert.equal(hasStoredSecretValue("", ""), false);
  assert.equal(isCachedSecretPlaceholder(CACHED_SECRET_PLACEHOLDER), true);
  assert.equal(isCachedSecretPlaceholder("plain-secret"), false);
});
