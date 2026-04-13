const test = require("node:test");
const assert = require("node:assert/strict");

const { createTimedAsyncCache } = require("../dist/src/timed-async-cache.js");

test("timed async cache reuses the cached value until the ttl expires", async () => {
  let now = 1_000;
  let loadCount = 0;
  const cache = createTimedAsyncCache({
    ttlMs: 5_000,
    now: () => now,
    load: async () => ({ value: ++loadCount }),
  });

  const first = await cache.get();
  now += 1_000;
  const second = await cache.get();
  now += 6_000;
  const third = await cache.get();

  assert.deepEqual(first, { value: 1 });
  assert.strictEqual(second, first);
  assert.deepEqual(third, { value: 2 });
  assert.equal(loadCount, 2);
});

test("timed async cache bypasses the cached value when force is requested", async () => {
  let loadCount = 0;
  const cache = createTimedAsyncCache({
    ttlMs: 60_000,
    load: async () => ({ value: ++loadCount }),
  });

  const first = await cache.get();
  const forced = await cache.get({ force: true });

  assert.deepEqual(first, { value: 1 });
  assert.deepEqual(forced, { value: 2 });
  assert.equal(loadCount, 2);
});

test("timed async cache coalesces concurrent callers onto the same in-flight load", async () => {
  let releaseLoad;
  let loadCount = 0;
  const cache = createTimedAsyncCache({
    ttlMs: 60_000,
    load: () => {
      loadCount += 1;
      return new Promise((resolve) => {
        releaseLoad = () => resolve({ value: loadCount });
      });
    },
  });

  const firstPromise = cache.get();
  const secondPromise = cache.get({ force: true });
  releaseLoad();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.strictEqual(second, first);
  assert.deepEqual(first, { value: 1 });
  assert.equal(loadCount, 1);
});

test("timed async cache clear drops stale in-flight results from earlier generations", async () => {
  let firstResolve;
  let secondResolve;
  let loadCount = 0;
  const cache = createTimedAsyncCache({
    ttlMs: 60_000,
    load: () => {
      loadCount += 1;
      if (loadCount === 1) {
        return new Promise((resolve) => {
          firstResolve = () => resolve({ value: "stale" });
        });
      }
      return new Promise((resolve) => {
        secondResolve = () => resolve({ value: "fresh" });
      });
    },
  });

  const stalePromise = cache.get();
  cache.clear();
  const freshPromise = cache.get();
  firstResolve();
  secondResolve();

  const [stale, fresh] = await Promise.all([stalePromise, freshPromise]);

  assert.deepEqual(stale, { value: "stale" });
  assert.deepEqual(fresh, { value: "fresh" });
  assert.deepEqual(cache.peek(), { value: "fresh" });
});
