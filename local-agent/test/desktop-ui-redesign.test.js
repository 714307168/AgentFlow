const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesCss = fs.readFileSync(path.join(__dirname, "../renderer/styles.css"), "utf8");
const settingsHtml = fs.readFileSync(path.join(__dirname, "../renderer/settings.html"), "utf8");

test("desktop workbench uses the AgentFlow reference redesign layer", () => {
  assert.match(stylesCss, /AgentFlow reference redesign layer/);
  assert.match(stylesCss, /--af-primary: #7c5cfc/);
  assert.match(stylesCss, /--af-flow: #22d3ee/);
  assert.match(stylesCss, /--af-bg-base: #09090b/);
  assert.match(stylesCss, /body::before/);
  assert.match(stylesCss, /body::after/);
  assert.match(stylesCss, /\.conversation-panel::before/);
  assert.match(stylesCss, /\.conversation-panel::after/);
  assert.match(stylesCss, /\.project-list-item\.selected::before/);
  assert.doesNotMatch(stylesCss, /\.panel-header::after/);
  assert.doesNotMatch(stylesCss, /\.sidebar-header::after/);
});

test("settings window shares the AgentFlow reference visual system", () => {
  assert.match(settingsHtml, /AgentFlow reference redesign layer for settings/);
  assert.match(settingsHtml, /--af-primary: #7c5cfc/);
  assert.match(settingsHtml, /--af-flow: #22d3ee/);
  assert.match(settingsHtml, /--af-bg-base: #09090b/);
  assert.match(settingsHtml, /body::before/);
  assert.match(settingsHtml, /body::after/);
  assert.match(settingsHtml, /\.section::before/);
  assert.match(settingsHtml, /\.section::after/);
  assert.match(settingsHtml, /\.model-provider-card\.active/);
});
