const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSessionSyncBackpressureEligible,
  mergeSessionSyncRequestOptions,
} = require("../dist/src/session-sync-flight-control.js");

test("isSessionSyncBackpressureEligible only accepts plain incremental session refreshes", () => {
  assert.equal(isSessionSyncBackpressureEligible({ limit: 30, summaryOnly: true }), true);
  assert.equal(isSessionSyncBackpressureEligible({ beforeSeq: 20, limit: 30 }), false);
  assert.equal(isSessionSyncBackpressureEligible({ action: "fetch_item_detail", itemId: "msg-1" }), false);
  assert.equal(isSessionSyncBackpressureEligible({ runId: "run-1" }), false);
  assert.equal(isSessionSyncBackpressureEligible({ projectUpdates: { cliModel: "sonnet" } }), false);
});

test("mergeSessionSyncRequestOptions keeps the strongest detail request and widest coverage", () => {
  const merged = mergeSessionSyncRequestOptions(
    { afterSeq: 24, limit: 20, summaryOnly: true },
    { afterSeq: 12, limit: 40, summaryOnly: false, conversationId: "conv-1" },
  );

  assert.deepEqual(merged, {
    afterSeq: 12,
    limit: 40,
    summaryOnly: false,
    conversationId: "conv-1",
  });
});
