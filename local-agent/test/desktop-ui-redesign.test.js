const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesCss = fs.readFileSync(path.join(__dirname, "../renderer/styles.css"), "utf8");
const settingsHtml = fs.readFileSync(path.join(__dirname, "../renderer/settings.html"), "utf8");

test("desktop workbench uses the Command Ledger redesign layer", () => {
  assert.match(stylesCss, /Command Ledger redesign layer/);
  assert.match(stylesCss, /--accent: #d9a441/);
  assert.match(stylesCss, /--ledger-rail: #d9a441/);
  assert.match(stylesCss, /body::before/);
  assert.match(stylesCss, /\.conversation-panel::before/);
  assert.match(stylesCss, /\.message-card\.assistant::before/);
});

test("settings window shares the Command Ledger visual system", () => {
  assert.match(settingsHtml, /Command Ledger redesign layer for settings/);
  assert.match(settingsHtml, /--accent: #d9a441/);
  assert.match(settingsHtml, /--ledger-rail: #d9a441/);
  assert.match(settingsHtml, /body::before/);
  assert.match(settingsHtml, /\.section::before/);
  assert.match(settingsHtml, /\.model-provider-card\.active/);
});
