const test = require("node:test");
const assert = require("node:assert/strict");

const rules = require("../dist/src/session-visibility-rules.js");

test("session visibility rules retain private sources and exclude workgroup events", () => {
  const messages = [
    { id: "m1", source: "desktop" },
    { id: "m2", source: "workgroup" },
    { id: "m3", source: "remote" },
  ];
  const activities = [
    { id: "a1", meta: { source: "desktop" } },
    { id: "a2", meta: { source: "workgroup" } },
    { id: "a3" },
  ];
  const queue = [
    { runId: "q1", source: "workgroup" },
    { runId: "q2", source: "desktop" },
  ];

  assert.deepEqual(rules.getVisibleProjectMessages({ messages }).map((entry) => entry.id), ["m1", "m3"]);
  assert.deepEqual(rules.getVisibleProjectActivities({ activities }).map((entry) => entry.id), ["a1", "a3"]);
  assert.deepEqual(rules.getVisibleProjectQueue({ queue }).map((entry) => entry.runId), ["q2"]);
  assert.equal(rules.getProjectVisibleCurrentSource({ currentSource: "workgroup" }), null);
  assert.equal(rules.getProjectVisibleCurrentSource({ currentSource: "desktop" }), "desktop");
});
