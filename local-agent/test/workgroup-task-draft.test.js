const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildWorkgroupTaskDraftPrompt,
  parseWorkgroupTaskDraftResponse,
} = require("../dist/src/workgroup-task-draft.js");

const members = [
  { id: "builder", name: "Builder", specialty: "implementer", available: true },
  { id: "offline-tester", name: "Offline tester", specialty: "tester", available: false },
];

test("PM task draft parser keeps valid task dependencies and eligible assignees", () => {
  const draft = parseWorkgroupTaskDraftResponse(`
    Here is the requested plan:
    \`\`\`json
    {
      "summary": "Build, then verify.",
      "tasks": [
        { "key": "build", "title": "Implement the change", "assigneeMemberId": "builder", "priority": "high" },
        { "key": "verify", "title": "Verify the change", "dependsOnKeys": ["build"], "assigneeMemberId": "offline-tester" }
      ]
    }
    \`\`\`
  `, members);

  assert.equal(draft.summary, "Build, then verify.");
  assert.deepEqual(draft.tasks.map((task) => ({
    key: task.key,
    assigneeMemberId: task.assigneeMemberId,
    dependsOnKeys: task.dependsOnKeys,
    priority: task.priority,
  })), [
    { key: "build", assigneeMemberId: "builder", dependsOnKeys: [], priority: "high" },
    { key: "verify", assigneeMemberId: null, dependsOnKeys: ["build"], priority: "normal" },
  ]);
});

test("PM task draft parser rejects cyclic dependencies", () => {
  assert.throws(() => parseWorkgroupTaskDraftResponse(JSON.stringify({
    tasks: [
      { key: "first", title: "First", dependsOnKeys: ["second"] },
      { key: "second", title: "Second", dependsOnKeys: ["first"] },
    ],
  }), members), /cyclic/i);
});

test("PM task prompt requires a proposal without execution", () => {
  const prompt = buildWorkgroupTaskDraftPrompt({
    workgroupName: "Release swarm",
    goal: "Ship the release safely",
    members,
  });

  assert.match(prompt, /Do not execute commands/i);
  assert.match(prompt, /inactive until a human explicitly confirms/i);
  assert.match(prompt, /"builder"/);
});
