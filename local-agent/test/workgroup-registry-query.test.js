const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createWorkgroupRegistryMembersCacheKey,
  normalizeWorkgroupRegistryMembersQuery,
  normalizeWorkgroupRegistrySearchQuery,
  parseWorkgroupRegistryMembersCacheKey,
} = require("../dist/src/workgroup-registry-query.js");

test("normalizeWorkgroupRegistrySearchQuery trims nullable input", () => {
  assert.equal(normalizeWorkgroupRegistrySearchQuery("  1234  "), "1234");
  assert.equal(normalizeWorkgroupRegistrySearchQuery(null), "");
});

test("normalizeWorkgroupRegistryMembersQuery trims and fills missing fields", () => {
  assert.deepEqual(
    normalizeWorkgroupRegistryMembersQuery({
      groupNumber: " 1001 ",
      workgroupId: " wg-1 ",
    }),
    {
      groupNumber: "1001",
      workgroupId: "wg-1",
      hostAgentId: "",
    },
  );
});

test("workgroup registry member cache keys stay stable across equivalent input", () => {
  const first = createWorkgroupRegistryMembersCacheKey({
    groupNumber: " 1001 ",
    workgroupId: "wg-1",
    hostAgentId: "",
  });
  const second = createWorkgroupRegistryMembersCacheKey({
    groupNumber: "1001",
    workgroupId: " wg-1 ",
  });

  assert.equal(first, second);
  assert.deepEqual(parseWorkgroupRegistryMembersCacheKey(first), {
    groupNumber: "1001",
    workgroupId: "wg-1",
    hostAgentId: "",
  });
});
