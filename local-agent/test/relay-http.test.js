const test = require("node:test");
const assert = require("node:assert/strict");
const { gunzipSync } = require("node:zlib");

const {
  RELAY_JSON_GZIP_THRESHOLD_BYTES,
  createRelayJsonRequestInit,
  shouldCompressRelayJsonPayload,
} = require("../dist/src/relay-http.js");

test("shouldCompressRelayJsonPayload only compresses non-empty payloads that meet the threshold", () => {
  assert.equal(shouldCompressRelayJsonPayload(0), false);
  assert.equal(shouldCompressRelayJsonPayload(RELAY_JSON_GZIP_THRESHOLD_BYTES - 1), false);
  assert.equal(shouldCompressRelayJsonPayload(RELAY_JSON_GZIP_THRESHOLD_BYTES), true);
  assert.equal(shouldCompressRelayJsonPayload(24, 0), true);
});

test("createRelayJsonRequestInit keeps small JSON payloads plain", () => {
  const init = createRelayJsonRequestInit({
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: { hello: "world" },
  });

  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer token");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.headers["Content-Encoding"], undefined);
  assert.equal(typeof init.body, "string");
  assert.deepEqual(JSON.parse(init.body), { hello: "world" });
});

test("createRelayJsonRequestInit gzips larger relay JSON payloads", () => {
  const init = createRelayJsonRequestInit({
    method: "POST",
    body: { content: "x".repeat(RELAY_JSON_GZIP_THRESHOLD_BYTES) },
  });

  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.headers["Content-Encoding"], "gzip");
  assert.equal(Buffer.isBuffer(init.body), true);
  assert.deepEqual(
    JSON.parse(gunzipSync(init.body).toString("utf8")),
    { content: "x".repeat(RELAY_JSON_GZIP_THRESHOLD_BYTES) },
  );
});
