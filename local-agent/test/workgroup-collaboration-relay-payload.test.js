const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWorkgroupCollaborationSessionRelayPayload,
  createWorkgroupCollaborationSnapshotRevision,
} = require("../dist/src/workgroup-collaboration-relay-payload.js");

function createSession() {
  return {
    workgroupId: "wg-1",
    workgroupName: "Alpha",
    description: "desc",
    allowDirectMemberMessages: true,
    updatedAt: 100,
    isRunning: false,
    messageTotal: 1,
    snapshotRevision: "",
    members: [
      {
        id: "m-1",
        name: "PM",
        role: "project_manager",
        projectId: null,
        projectName: null,
        projectKind: null,
        projectOnline: true,
        hasBinding: false,
        isRunning: false,
      },
    ],
    messages: [
      {
        id: "msg-1",
        workgroupId: "wg-1",
        senderType: "member",
        senderName: "PM",
        memberId: "m-1",
        memberRole: "project_manager",
        projectId: null,
        projectKind: null,
        dispatchRunId: null,
        triggerMessageId: null,
        content: "hello",
        status: "done",
        createdAt: 10,
        updatedAt: 10,
      },
    ],
  };
}

test("createWorkgroupCollaborationSnapshotRevision is deterministic", () => {
  const left = createSession();
  const right = createSession();
  assert.equal(
    createWorkgroupCollaborationSnapshotRevision(left),
    createWorkgroupCollaborationSnapshotRevision(right),
  );
});

test("buildWorkgroupCollaborationSessionRelayPayload omits repeated session payloads when snapshot is unchanged", () => {
  const session = createSession();
  const snapshotRevision = createWorkgroupCollaborationSnapshotRevision(session);
  const payload = buildWorkgroupCollaborationSessionRelayPayload({
    agentId: "agent-1",
    workgroupId: "wg-1",
    session: { ...session, snapshotRevision },
    page: {
      items: session.messages,
      hasMore: false,
      total: 1,
    },
    knownSnapshotRevision: snapshotRevision,
  });

  assert.equal(payload.snapshot_revision, snapshotRevision);
  assert.equal(payload.snapshot_unchanged, true);
  assert.deepEqual(payload.session.messages, []);
  assert.deepEqual(payload.page.items, []);
});

test("buildWorkgroupCollaborationSessionRelayPayload preserves delta payloads for history paging", () => {
  const session = createSession();
  const snapshotRevision = createWorkgroupCollaborationSnapshotRevision(session);
  const payload = buildWorkgroupCollaborationSessionRelayPayload({
    agentId: "agent-1",
    workgroupId: "wg-1",
    session: { ...session, snapshotRevision },
    page: {
      items: session.messages,
      hasMore: true,
      total: 5,
    },
    beforeId: "msg-1",
    knownSnapshotRevision: snapshotRevision,
  });

  assert.equal(payload.snapshot_unchanged, undefined);
  assert.equal(payload.page.items.length, 1);
  assert.equal(payload.page.hasMore, true);
});
