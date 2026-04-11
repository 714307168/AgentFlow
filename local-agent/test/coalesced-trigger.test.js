const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCoalescedTrigger,
} = require("../dist/src/coalesced-trigger.js");

test("coalesced trigger runs immediately, then schedules only one trailing task", () => {
  let nowMs = 1_000;
  const scheduled = [];
  const calls = [];

  const trigger = createCoalescedTrigger({
    minIntervalMs: 500,
    now: () => nowMs,
    setTimer: (callback, delayMs) => {
      const handle = { callback, delayMs, cleared: false };
      scheduled.push(handle);
      return handle;
    },
    clearTimer: (handle) => {
      handle.cleared = true;
    },
  });

  assert.deepEqual(trigger.trigger(() => calls.push("first")), { immediate: true, scheduled: false });
  assert.deepEqual(calls, ["first"]);

  nowMs = 1_100;
  assert.deepEqual(trigger.trigger(() => calls.push("second")), { immediate: false, scheduled: true });
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 400);

  nowMs = 1_200;
  assert.deepEqual(trigger.trigger(() => calls.push("third")), { immediate: false, scheduled: true });
  assert.equal(scheduled.length, 1);

  nowMs = 1_500;
  scheduled[0].callback();
  assert.deepEqual(calls, ["first", "third"]);

  trigger.dispose();
});

test("coalesced trigger dispose clears pending timer and prevents trailing task", () => {
  let nowMs = 5_000;
  let callbackRan = false;
  let cleared = false;
  let handle = null;

  const trigger = createCoalescedTrigger({
    minIntervalMs: 1_000,
    now: () => nowMs,
    setTimer: (callback, delayMs) => {
      handle = { callback, delayMs };
      return handle;
    },
    clearTimer: () => {
      cleared = true;
    },
  });

  trigger.trigger(() => {});
  nowMs = 5_100;
  trigger.trigger(() => {
    callbackRan = true;
  });

  trigger.dispose();
  assert.equal(cleared, true);
  handle.callback();
  assert.equal(callbackRan, false);
});
