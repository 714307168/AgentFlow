const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWorkgroupRelayPayload,
  buildWorkgroupListResponsePayload,
  createWorkgroupRelayRevision,
} = require("../dist/src/workgroup-relay-payload.js");

test("buildWorkgroupRelayPayload returns null when agent id is blank", () => {
  assert.equal(buildWorkgroupRelayPayload("  ", []), null);
});

test("buildWorkgroupRelayPayload includes a stable revision for the serialized workgroups", () => {
  const workgroups = [
    {
      id: "wg-1",
      name: "Alpha",
      tasks: [{ id: "task-1", title: "Plan" }],
      members: [{ id: "member-1", name: "PM" }],
    },
  ];
  const payload = buildWorkgroupRelayPayload("agent-1", workgroups);
  assert.ok(payload);
  assert.equal(payload.agent_id, "agent-1");
  assert.equal(payload.workgroups, workgroups);
  assert.equal(payload.revision, createWorkgroupRelayRevision(workgroups));
});

test("createWorkgroupRelayRevision is deterministic for equal payloads", () => {
  const left = [{ id: "wg-1", tasks: [{ id: "task-1", title: "Plan" }] }];
  const right = [{ id: "wg-1", tasks: [{ id: "task-1", title: "Plan" }] }];
  assert.equal(createWorkgroupRelayRevision(left), createWorkgroupRelayRevision(right));
});

test("buildWorkgroupListResponsePayload elides workgroups when the caller already knows the revision", () => {
  const workgroups = [{ id: "wg-1", name: "Alpha" }];
  const payload = buildWorkgroupRelayPayload("agent-1", workgroups);
  const response = buildWorkgroupListResponsePayload(payload, payload.revision);
  assert.deepEqual(response, {
    agent_id: "agent-1",
    revision: payload.revision,
    changed: false,
    workgroups: [],
  });
});

test("buildWorkgroupListResponsePayload returns the full payload when revision changed", () => {
  const workgroups = [{ id: "wg-1", name: "Alpha" }];
  const payload = buildWorkgroupRelayPayload("agent-1", workgroups);
  const response = buildWorkgroupListResponsePayload(payload, "older-revision");
  assert.deepEqual(response, {
    agent_id: "agent-1",
    revision: payload.revision,
    changed: true,
    workgroups,
  });
});
