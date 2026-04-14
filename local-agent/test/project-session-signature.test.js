const test = require("node:test");
const assert = require("node:assert/strict");

const { createProjectSessionSignature } = require("../dist/src/project-session-signature.js");

function buildSnapshot(overrides = {}) {
  return {
    projectId: "project-a",
    provider: "claude",
    model: "sonnet",
    automationMode: "full-auto",
    projectSignature: null,
    isRunning: false,
    queuedCount: 0,
    currentSource: null,
    currentPrompt: null,
    currentStartedAt: null,
    activeConversationId: "conv-1",
    conversations: [],
    messageTotal: 0,
    activityTotal: 0,
    cliTraceTotal: 0,
    queue: [],
    cliTrace: [],
    messages: [],
    activities: [],
    sessionRefs: {
      claudeSessionId: null,
      codexThreadId: null,
    },
    ...overrides,
  };
}

test("createProjectSessionSignature stays stable for equivalent snapshots", () => {
  const left = buildSnapshot({
    currentPrompt: "hello",
    messages: [{ id: "m1", role: "assistant", content: "done", source: "desktop", createdAt: 10, updatedAt: 20, status: "done" }],
  });
  const right = buildSnapshot({
    currentPrompt: "hello",
    messages: [{ id: "m1", role: "assistant", content: "done", source: "desktop", createdAt: 10, updatedAt: 20, status: "done" }],
  });

  assert.equal(
    createProjectSessionSignature(left, "rev-1"),
    createProjectSessionSignature(right, "rev-1"),
  );
});

test("createProjectSessionSignature changes when the shell summary changes", () => {
  const idle = buildSnapshot({
    messages: [{ id: "m1", role: "assistant", content: "done", source: "desktop", createdAt: 10, updatedAt: 20, status: "done" }],
  });
  const busy = buildSnapshot({
    isRunning: true,
    currentPrompt: "working",
    messages: [{ id: "m1", role: "assistant", content: "done", source: "desktop", createdAt: 10, updatedAt: 20, status: "done" }],
  });

  assert.notEqual(
    createProjectSessionSignature(idle, "rev-1"),
    createProjectSessionSignature(busy, "rev-2"),
  );
});
