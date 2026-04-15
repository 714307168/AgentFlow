const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createProjectSyncBucket,
  PROJECT_SYNC_BUCKET_HOT_AGE_MS,
  PROJECT_SYNC_BUCKET_WARM_AGE_MS,
  PROJECT_SYNC_BUCKET_COLD_AGE_MS,
} = require("../dist/src/project-sync-bucket.js");

function buildSnapshot(overrides = {}) {
  return {
    projectId: "project-a",
    provider: "claude",
    model: "sonnet",
    automationMode: "full-auto",
    projectSignature: null,
    syncBucket: null,
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

test("createProjectSyncBucket marks running or queued sessions as hot", () => {
  assert.equal(
    createProjectSyncBucket(buildSnapshot({ isRunning: true }), PROJECT_SYNC_BUCKET_COLD_AGE_MS * 2),
    "hot",
  );
  assert.equal(
    createProjectSyncBucket(buildSnapshot({ queuedCount: 1 }), PROJECT_SYNC_BUCKET_COLD_AGE_MS * 2),
    "hot",
  );
});

test("createProjectSyncBucket ages idle sessions across hot warm cold and dormant buckets", () => {
  const nowMs = PROJECT_SYNC_BUCKET_COLD_AGE_MS * 2;

  assert.equal(
    createProjectSyncBucket(
      buildSnapshot({ messages: [{ id: "m1", role: "assistant", content: "fresh", source: "desktop", createdAt: nowMs - 1_000, updatedAt: nowMs - 1_000, status: "done" }] }),
      nowMs,
    ),
    "hot",
  );
  assert.equal(
    createProjectSyncBucket(
      buildSnapshot({ messages: [{ id: "m1", role: "assistant", content: "warm", source: "desktop", createdAt: nowMs - PROJECT_SYNC_BUCKET_HOT_AGE_MS - 1_000, updatedAt: nowMs - PROJECT_SYNC_BUCKET_HOT_AGE_MS - 1_000, status: "done" }] }),
      nowMs,
    ),
    "warm",
  );
  assert.equal(
    createProjectSyncBucket(
      buildSnapshot({ messages: [{ id: "m1", role: "assistant", content: "cold", source: "desktop", createdAt: nowMs - PROJECT_SYNC_BUCKET_WARM_AGE_MS - 1_000, updatedAt: nowMs - PROJECT_SYNC_BUCKET_WARM_AGE_MS - 1_000, status: "done" }] }),
      nowMs,
    ),
    "cold",
  );
  assert.equal(
    createProjectSyncBucket(
      buildSnapshot({ messages: [{ id: "m1", role: "assistant", content: "dormant", source: "desktop", createdAt: nowMs - PROJECT_SYNC_BUCKET_COLD_AGE_MS - 1_000, updatedAt: nowMs - PROJECT_SYNC_BUCKET_COLD_AGE_MS - 1_000, status: "done" }] }),
      nowMs,
    ),
    "dormant",
  );
});
