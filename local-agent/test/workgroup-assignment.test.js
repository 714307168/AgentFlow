const test = require("node:test");
const assert = require("node:assert/strict");

const { recommendWorkgroupTaskAssignee } = require("../dist/src/workgroup-assignment.js");

const available = (overrides = {}) => ({
  id: "member",
  name: "Member",
  specialty: "general",
  projectId: "project",
  projectExists: true,
  projectOnline: true,
  ...overrides,
});

test("recommends the available specialist that matches the task language", () => {
  const recommendation = recommendWorkgroupTaskAssignee(
    { title: "Implement the login fix", description: "Refactor the authentication code." },
    [
      available({ id: "reviewer", name: "Review", specialty: "reviewer" }),
      available({ id: "implementer", name: "Build", specialty: "implementer" }),
      available({ id: "general", name: "General", specialty: "general" }),
    ],
  );

  assert.deepEqual(recommendation, {
    memberId: "implementer",
    memberName: "Build",
    specialty: "implementer",
    reason: "Matches implementation.",
  });
});

test("falls back to an available generalist and excludes unavailable members", () => {
  const recommendation = recommendWorkgroupTaskAssignee(
    { title: "Investigate the production incident" },
    [
      available({ id: "offline-researcher", name: "Offline research", specialty: "researcher", projectOnline: false }),
      available({ id: "unbound-researcher", name: "Unbound research", specialty: "researcher", projectId: null }),
      available({ id: "general", name: "Available generalist", specialty: "general" }),
    ],
  );

  assert.deepEqual(recommendation, {
    memberId: "general",
    memberName: "Available generalist",
    specialty: "general",
    reason: "Available generalist fallback.",
  });
});

test("returns no recommendation when no member is available", () => {
  assert.equal(recommendWorkgroupTaskAssignee(
    { title: "Test the release" },
    [available({ projectExists: false }), available({ id: "offline", projectOnline: false })],
  ), null);
});
