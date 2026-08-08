const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isFieldNodeCommandAction,
  runFieldNodeCommand,
} = require("../dist/src/field-node-command.js");

test("field node commands only accept the fixed allowlist", () => {
  assert.equal(isFieldNodeCommandAction("ping"), true);
  assert.equal(isFieldNodeCommandAction("runtime-status"), true);
  assert.equal(isFieldNodeCommandAction("disk-status"), true);
  assert.equal(isFieldNodeCommandAction("dir C:\\"), false);
  assert.equal(isFieldNodeCommandAction(""), false);
});

test("runtime status uses the packaged runtime and returns a bounded result", async () => {
  const result = await runFieldNodeCommand("runtime-status");

  assert.equal(result.action, "runtime-status");
  assert.equal(result.ok, true);
  assert.match(result.output, /^v\d+/);
  assert.ok(result.executedAt > 0);
  assert.ok(Buffer.byteLength(result.output) <= 16 * 1024);
});
