const test = require("node:test");
const assert = require("node:assert/strict");

const { extractWorkgroupTaskEvidence } = require("../dist/src/workgroup-task-evidence.js");

test("extracts bounded artifact and validation evidence from a member report", () => {
  const evidence = extractWorkgroupTaskEvidence(`
    Outcome: Delivered the change.
    Artifacts: src/auth.ts\npackage-lock.json
    Validation: npm test (298 passed)
    Blockers: None
  `);

  assert.deepEqual(evidence, {
    artifactSummary: "src/auth.ts\npackage-lock.json",
    validationEvidence: "npm test (298 passed)",
  });
});

test("supports Chinese report labels and ignores unlabeled prose", () => {
  const evidence = extractWorkgroupTaskEvidence(`
    已完成发布。
    产物：release-notes.md
    验证：冒烟测试通过
    交接：等待人工验收
  `);

  assert.equal(evidence.artifactSummary, "release-notes.md");
  assert.equal(evidence.validationEvidence, "冒烟测试通过");
});
