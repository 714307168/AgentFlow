const test = require("node:test");
const assert = require("node:assert/strict");

const { createRequestGate } = require("../dist/src/request-gate.js");

test("request gate blocks duplicate starts while a key is pending", () => {
  let now = 1_000;
  const gate = createRequestGate({
    minIntervalMs: 5_000,
    pendingTimeoutMs: 60_000,
    now: () => now,
  });

  assert.equal(gate.tryStart("project-a"), true);
  now += 100;
  assert.equal(gate.tryStart("project-a"), false);
  assert.equal(gate.tryStart("project-a", { force: true }), false);
});

test("request gate enforces min interval after finish unless force is set", () => {
  let now = 1_000;
  const gate = createRequestGate({
    minIntervalMs: 5_000,
    pendingTimeoutMs: 60_000,
    now: () => now,
  });

  assert.equal(gate.tryStart("project-a"), true);
  gate.finish("project-a");
  now += 1_000;
  assert.equal(gate.tryStart("project-a"), false);
  assert.equal(gate.tryStart("project-a", { force: true }), true);
});

test("request gate timeout releases pending keys automatically", async () => {
  const gate = createRequestGate({
    minIntervalMs: 0,
    pendingTimeoutMs: 25,
  });

  assert.equal(gate.tryStart("project-a"), true);
  assert.equal(gate.tryStart("project-a"), false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(gate.tryStart("project-a"), true);
});

test("request gate clear releases all pending keys", () => {
  const gate = createRequestGate({
    minIntervalMs: 0,
    pendingTimeoutMs: 60_000,
  });

  assert.equal(gate.tryStart("a"), true);
  assert.equal(gate.tryStart("b"), true);
  gate.clear();
  assert.equal(gate.tryStart("a"), true);
  assert.equal(gate.tryStart("b"), true);
});
