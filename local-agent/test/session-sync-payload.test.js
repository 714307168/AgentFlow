const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSessionSyncPayload } = require("../dist/src/session-sync-payload.js");

function createSnapshot(overrides = {}) {
  return {
    projectId: "project-1",
    provider: "claude",
    model: "sonnet",
    automationMode: "full-auto",
    projectSignature: "signature-1",
    syncBucket: "hot",
    isRunning: true,
    queuedCount: 1,
    currentSource: "desktop",
    currentPrompt: "ship it",
    currentStartedAt: 1700000000000,
    activeConversationId: "conv-1",
    conversations: [{
      id: "conv-1",
      title: "Release",
      createdAt: 1700000000000,
      updatedAt: 1700000002000,
      isActive: true,
      messageCount: 2,
      activityCount: 1,
      cliCount: 1,
    }],
    messageTotal: 2,
    activityTotal: 1,
    cliTraceTotal: 1,
    queue: [{
      runId: "run-1",
      prompt: "queued prompt",
      source: "desktop",
      queuedAt: 1700000001000,
    }],
    cliTrace: [{
      id: "cli-1",
      stream: "stdout",
      text: "output",
      createdAt: 1700000003000,
    }],
    messages: [{
      id: "msg-1",
      role: "assistant",
      content: "hello world",
      source: "desktop",
      createdAt: 1700000001000,
      updatedAt: 1700000002000,
      status: "done",
    }],
    activities: [{
      id: "act-1",
      kind: "status",
      title: "Running",
      detail: "working",
      status: "running",
      createdAt: 1700000001500,
      updatedAt: 1700000002500,
    }],
    sessionRefs: {
      claudeSessionId: null,
      codexThreadId: null,
    },
    ...overrides,
  };
}

function createDelta(overrides = {}) {
  return {
    latestSeq: 3,
    truncated: false,
    items: [{
      id: "msg-1",
      kind: "message",
      seq: 3,
      createdAt: 1700000001000,
      updatedAt: 1700000002000,
      role: "assistant",
      source: "desktop",
      content: "hello world",
      attachments: [],
      status: "done",
    }],
    ...overrides,
  };
}

test("buildSessionSyncPayload omits sync items for summary-only requests", () => {
  const payload = buildSessionSyncPayload(
    createSnapshot(),
    createDelta(),
    {
      summaryOnly: true,
    },
  );

  assert.equal(payload.sync.latest_seq, 3);
  assert.deepEqual(payload.sync.items, []);
  assert.equal(payload.isRunning, true);
  assert.equal(payload.active_conversation_id, "conv-1");
  assert.equal(payload.queue?.length, 1);
});

test("buildSessionSyncPayload keeps sync items for full-detail requests", () => {
  const payload = buildSessionSyncPayload(
    createSnapshot(),
    createDelta(),
    {
      summaryOnly: false,
    },
  );

  assert.equal(payload.sync.items.length, 1);
  assert.equal(payload.sync.items[0].id, "msg-1");
});
