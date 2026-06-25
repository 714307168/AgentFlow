const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const settingsHtml = fs.readFileSync(path.join(__dirname, "../renderer/settings.html"), "utf8");

test("settings page splits system settings into standalone panes", () => {
  const expectedPanes = [
    "overview",
    "connection",
    "project",
    "workgroup",
    "transfer",
    "automation",
    "language",
    "launch",
    "runtime",
    "updates",
    "storage",
    "schedule",
    "security",
  ];

  for (const pane of expectedPanes) {
    assert.match(settingsHtml, new RegExp(`data-pane="${pane}"`), `missing nav item for ${pane}`);
    assert.match(settingsHtml, new RegExp(`data-pane-content="${pane}"`), `missing pane content for ${pane}`);
  }

  assert.doesNotMatch(settingsHtml, /data-pane="advanced"/);
  assert.doesNotMatch(settingsHtml, /data-pane-content="advanced"/);
  assert.doesNotMatch(settingsHtml, /data-pane="message"/);
  assert.doesNotMatch(settingsHtml, /data-pane-content="message"/);
  assert.doesNotMatch(settingsHtml, /Projects & Workgroups/);
  assert.doesNotMatch(settingsHtml, /Messages & Files/);
});
