const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldUseSummaryOnlyProjectSync } = require("../dist/src/remote-project-sync-priority.js");

test("shouldUseSummaryOnlyProjectSync keeps the active project on full detail in auto mode", () => {
  assert.equal(
    shouldUseSummaryOnlyProjectSync({
      projectId: "project-1",
      activeProjectId: "project-1",
      detailMode: "auto",
    }),
    false,
  );
});

test("shouldUseSummaryOnlyProjectSync downgrades inactive projects to summary mode in auto mode", () => {
  assert.equal(
    shouldUseSummaryOnlyProjectSync({
      projectId: "project-2",
      activeProjectId: "project-1",
      detailMode: "auto",
    }),
    true,
  );
});

test("shouldUseSummaryOnlyProjectSync honors explicit full and summary overrides", () => {
  assert.equal(
    shouldUseSummaryOnlyProjectSync({
      projectId: "project-2",
      activeProjectId: "project-1",
      detailMode: "full",
    }),
    false,
  );
  assert.equal(
    shouldUseSummaryOnlyProjectSync({
      projectId: "project-2",
      activeProjectId: "project-1",
      detailMode: "summary",
    }),
    true,
  );
});
