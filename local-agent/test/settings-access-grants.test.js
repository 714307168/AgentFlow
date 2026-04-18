const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProjectPickerMarkup,
  filterProjects,
  formatProjectSelectionSummary,
  normalizeProjectIds,
} = require("../renderer/settings-access-grants.js");

test("normalizeProjectIds trims blanks and removes duplicates", () => {
  assert.deepEqual(
    normalizeProjectIds([" project-a ", "", null, "project-b", "project-a", "  "]),
    ["project-a", "project-b"],
  );
});

test("filterProjects matches by name path and provider", () => {
  const projects = [
    { id: "a", name: "Alpha", path: "D:/alpha", cliProvider: "claude" },
    { id: "b", name: "Bravo", path: "D:/team/bravo", cliProvider: "codex" },
  ];
  assert.deepEqual(filterProjects(projects, "brav").map((project) => project.id), ["b"]);
  assert.deepEqual(filterProjects(projects, "team").map((project) => project.id), ["b"]);
  assert.deepEqual(filterProjects(projects, "codex").map((project) => project.id), ["b"]);
});

test("buildProjectPickerMarkup renders checked project rows and empty states", () => {
  const projects = [
    { id: "project-a", name: "Alpha", path: "D:/alpha", cliProvider: "claude" },
    { id: "project-b", name: "Bravo", path: "D:/bravo", cliProvider: "codex" },
  ];
  const markup = buildProjectPickerMarkup({
    projects,
    selectedProjectIds: ["project-b"],
    filterText: "br",
    emptyMessage: "No local projects available yet.",
    noResultsMessage: "No matching local projects.",
    resolveProviderLabel: (project) => project.cliProvider,
    escapeHtml: (value) => String(value),
  });
  assert.match(markup, /project-b/);
  assert.match(markup, /checked/);
  assert.doesNotMatch(markup, /project-a/);
  assert.match(
    buildProjectPickerMarkup({
      projects,
      selectedProjectIds: [],
      filterText: "zzz",
      noResultsMessage: "No matching local projects.",
      escapeHtml: (value) => String(value),
    }),
    /No matching local projects\./,
  );
});

test("formatProjectSelectionSummary counts only currently available projects", () => {
  const summary = formatProjectSelectionSummary({
    projects: [
      { id: "project-a" },
      { id: "project-b" },
    ],
    selectedProjectIds: ["project-b", "project-c"],
    formatter: (selectedCount, totalCount) => `${selectedCount}/${totalCount}`,
  });
  assert.equal(summary, "1/2");
});
