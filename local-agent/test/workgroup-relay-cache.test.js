const test = require("node:test");
const assert = require("node:assert/strict");

const { WorkgroupRelayCache } = require("../dist/src/workgroup-relay-cache.js");

test("WorkgroupRelayCache reuses the computed snapshot until invalidated", () => {
  const cache = new WorkgroupRelayCache();
  let loadCount = 0;
  const loadWorkgroups = () => {
    loadCount += 1;
    return [{ id: `wg-${loadCount}` }];
  };

  const first = cache.get("agent-1", loadWorkgroups);
  const second = cache.get("agent-1", loadWorkgroups);

  assert.equal(loadCount, 1);
  assert.deepEqual(first.workgroups, [{ id: "wg-1" }]);
  assert.equal(second, first);
});

test("WorkgroupRelayCache rebuilds after invalidation", () => {
  const cache = new WorkgroupRelayCache();
  let loadCount = 0;
  const loadWorkgroups = () => {
    loadCount += 1;
    return [{ id: `wg-${loadCount}` }];
  };

  const first = cache.get("agent-1", loadWorkgroups);
  cache.invalidate();
  const second = cache.get("agent-1", loadWorkgroups);

  assert.equal(loadCount, 2);
  assert.notEqual(second, first);
  assert.deepEqual(second.workgroups, [{ id: "wg-2" }]);
});

test("WorkgroupRelayCache rebuilds when the agent id changes", () => {
  const cache = new WorkgroupRelayCache();
  let loadCount = 0;
  const loadWorkgroups = () => {
    loadCount += 1;
    return [{ id: `wg-${loadCount}` }];
  };

  cache.get("agent-1", loadWorkgroups);
  const second = cache.get("agent-2", loadWorkgroups);

  assert.equal(loadCount, 2);
  assert.equal(second.agentId, "agent-2");
  assert.deepEqual(second.workgroups, [{ id: "wg-2" }]);
});
