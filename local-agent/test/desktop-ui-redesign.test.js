const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesCss = fs.readFileSync(path.join(__dirname, "../renderer/styles.css"), "utf8");
const settingsHtml = fs.readFileSync(path.join(__dirname, "../renderer/settings.html"), "utf8");

test("desktop workbench uses the Signal Atlas redesign layer", () => {
  assert.match(stylesCss, /Signal Atlas redesign layer/);
  assert.match(stylesCss, /--accent: #70f0d0/);
  assert.match(stylesCss, /body::before/);
  assert.match(stylesCss, /\.conversation-panel::before/);
  assert.match(stylesCss, /\.message-card\.assistant::before/);
});

test("settings window shares the Signal Atlas visual system", () => {
  assert.match(settingsHtml, /Signal Atlas redesign layer for settings/);
  assert.match(settingsHtml, /--accent: #70f0d0/);
  assert.match(settingsHtml, /body::before/);
  assert.match(settingsHtml, /\.section::before/);
  assert.match(settingsHtml, /\.model-provider-card\.active/);
});
