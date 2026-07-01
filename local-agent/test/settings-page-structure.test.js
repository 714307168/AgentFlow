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
    "skills",
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

test("settings page presents settings panes through a modal launcher", () => {
  assert.match(settingsHtml, /id="settingsModal"/);
  assert.match(settingsHtml, /class="settings-main settings-modal hidden"/);
  assert.match(settingsHtml, /id="settingsModalBody"/);
  assert.match(settingsHtml, /id="settingsModalCloseBtn"/);
  assert.match(settingsHtml, /function preloadSettingsPaneData\(\)/);
  assert.match(settingsHtml, /await ensurePaneDataLoaded\(activeSettingsPane\)/);
});

test("settings update status card renders download progress as a background bar", () => {
  assert.match(settingsHtml, /class="pubkey update-status-card" id="updateStatusText"><span>/);
  assert.match(settingsHtml, /--update-progress: 0%/);
  assert.match(settingsHtml, /\.update-status-card::before[\s\S]*width: var\(--update-progress\)/);
  assert.match(settingsHtml, /function normalizeUpdateProgressPercent\(state\)/);
  assert.match(settingsHtml, /updateStatusEl\.style\.setProperty\("--update-progress", `\$\{progressPercent\}%`\)/);
  assert.match(settingsHtml, /updateStatusEl\.classList\.toggle\("update-progress-active", normalized\.status === "downloading"\)/);
});

test("settings page exposes a skill catalog pane", () => {
  assert.match(settingsHtml, /id="skillsMenuItem"[^>]+data-pane="skills"/);
  assert.match(settingsHtml, /id="skillsPane"[^>]+data-pane-content="skills"/);
  assert.match(settingsHtml, /id="skillCatalogList"/);
  assert.match(settingsHtml, /function loadSkillCatalog\(options = \{\}\)/);
  assert.match(settingsHtml, /api\.listSkillCatalog\(\{ translateToZh \}\)/);
  assert.match(settingsHtml, /id="translateSkillCatalogBtn"/);
  assert.match(settingsHtml, /\.skill-safety-pill/);
  assert.match(settingsHtml, /"<div class=\\\"skill-safety-pill "/);
  assert.match(settingsHtml, /function formatSkillSafetyLevel\(level\)/);
  assert.match(settingsHtml, /riskyCount/);
});

test("settings runtime pane manages model credentials through provider profiles", () => {
  assert.match(settingsHtml, /id="modelProviderList"/);
  assert.match(settingsHtml, /id="modelProviderEditor"/);
  assert.match(settingsHtml, /id="modelProviderPreset"/);
  assert.match(settingsHtml, /function renderModelProviderProfiles()/);
  assert.match(settingsHtml, /modelProviderProfiles/);
  assert.doesNotMatch(settingsHtml, /id="openaiApiKey"/);
  assert.doesNotMatch(settingsHtml, /id="anthropicApiKey"/);
});
