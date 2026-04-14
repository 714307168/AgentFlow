const test = require("node:test");
const assert = require("node:assert/strict");

const { createKeyedTimedAsyncCache } = require("../dist/src/keyed-timed-async-cache.js");

test("keyed timed async cache reuses cached values per key until ttl expiry", async () => {
  let now = 1_000;
  const loadCounts = new Map();
  const cache = createKeyedTimedAsyncCache({
    ttlMs: 5_000,
    now: () => now,
    load: async (key) => {
      const count = (loadCounts.get(key) || 0) + 1;
      loadCounts.set(key, count);
      return { key, count };
    },
  });

  const firstA = await cache.get("a");
  const firstB = await cache.get("b");
  now += 1_000;
  const secondA = await cache.get("a");
  now += 6_000;
  const thirdA = await cache.get("a");

  assert.deepEqual(firstA, { key: "a", count: 1 });
  assert.deepEqual(firstB, { key: "b", count: 1 });
  assert.strictEqual(secondA, firstA);
  assert.deepEqual(thirdA, { key: "a", count: 2 });
});

test("keyed timed async cache force refresh only reloads the requested key", async () => {
  const loadCounts = new Map();
  const cache = createKeyedTimedAsyncCache({
    ttlMs: 60_000,
    load: async (key) => {
      const count = (loadCounts.get(key) || 0) + 1;
      loadCounts.set(key, count);
      return { key, count };
    },
  });

  const firstA = await cache.get("a");
  const forcedA = await cache.get("a", { force: true });
  const firstB = await cache.get("b");

  assert.deepEqual(firstA, { key: "a", count: 1 });
  assert.deepEqual(forcedA, { key: "a", count: 2 });
  assert.deepEqual(firstB, { key: "b", count: 1 });
});

test("keyed timed async cache coalesces concurrent callers on the same key only", async () => {
  let releaseA;
  let releaseB;
  const loadCounts = new Map();
  const cache = createKeyedTimedAsyncCache({
    ttlMs: 60_000,
    load: (key) => {
      const count = (loadCounts.get(key) || 0) + 1;
      loadCounts.set(key, count);
      return new Promise((resolve) => {
        if (key === "a") {
          releaseA = () => resolve({ key, count });
        } else {
          releaseB = () => resolve({ key, count });
        }
      });
    },
  });

  const firstA = cache.get("a");
  const secondA = cache.get("a", { force: true });
  const firstB = cache.get("b");
  releaseA();
  releaseB();

  const [a1, a2, b1] = await Promise.all([firstA, secondA, firstB]);
  assert.strictEqual(a1, a2);
  assert.deepEqual(a1, { key: "a", count: 1 });
  assert.deepEqual(b1, { key: "b", count: 1 });
});

test("keyed timed async cache clear invalidates one key without touching the others", async () => {
  const loadCounts = new Map();
  const cache = createKeyedTimedAsyncCache({
    ttlMs: 60_000,
    load: async (key) => {
      const count = (loadCounts.get(key) || 0) + 1;
      loadCounts.set(key, count);
      return { key, count };
    },
  });

  await cache.get("a");
  await cache.get("b");
  cache.clear("a");
  const nextA = await cache.get("a");
  const nextB = await cache.get("b");

  assert.deepEqual(nextA, { key: "a", count: 2 });
  assert.deepEqual(nextB, { key: "b", count: 1 });
});
