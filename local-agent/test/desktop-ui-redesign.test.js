const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const stylesCss = fs.readFileSync(path.join(__dirname, "../renderer/styles.css"), "utf8");
const flowDeckCss = fs.readFileSync(path.join(__dirname, "../renderer/flow-deck.css"), "utf8");
const terminalHtml = fs.readFileSync(path.join(__dirname, "../renderer/index.html"), "utf8");
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
  assert.match(stylesCss, /\.project-list-top \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(stylesCss, /\.project-list-name-row \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.doesNotMatch(stylesCss, /\.panel-header::after/);
  assert.doesNotMatch(stylesCss, /\.sidebar-header::after/);
});

test("desktop composer exposes per-project model switching next to the prompt", () => {
  assert.match(terminalHtml, /id="composerModelBtn"/);
  assert.match(terminalHtml, /class="ghost-button composer-model-button"/);
  assert.match(terminalHtml, /id="composerRunModeSelect"/);
  assert.match(terminalHtml, /<option value="plan">Plan<\/option>/);
  assert.match(terminalHtml, /<option value="goal">Goal<\/option>/);
  assert.match(terminalHtml, /id="composerReasoningSelect"/);
  assert.match(terminalHtml, /<option value="xhigh">XHigh<\/option>/);
  assert.match(terminalHtml, /id="voiceInputBtn"/);
  assert.match(stylesCss, /\.composer-model-button \{/);
  assert.match(stylesCss, /\.composer-model-button,\s*\.composer-mode-select \{[\s\S]*border-radius: 999px;/);
  assert.match(stylesCss, /\.composer-mode-select \{/);
  assert.match(stylesCss, /\.composer-reasoning-select \{/);
  assert.match(stylesCss, /\.voice-input-button\.listening \{/);
  assert.match(stylesCss, /\.model-switch-provider-meta \{/);
  assert.match(stylesCss, /\.model-switch-source-chip \{/);
  assert.match(stylesCss, /max-width: 240px/);
  assert.match(stylesCss, /text-overflow: ellipsis/);
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
  assert.match(settingsHtml, /Final dark guard/);
  assert.match(settingsHtml, /\.settings-modal-body \{[\s\S]*background: var\(--af-bg-base\);/);
  assert.match(settingsHtml, /\.project-item\.project-item-form,[\s\S]*background: var\(--af-bg-elevated\);/);
  assert.match(settingsHtml, /\.settings-nav-item,[\s\S]*color: var\(--af-text-primary\);/);
  assert.match(settingsHtml, /\.project-name,[\s\S]*color: var\(--af-text-primary\);/);
  assert.match(settingsHtml, /\.project-path,[\s\S]*color: var\(--af-text-secondary\);/);
  assert.match(settingsHtml, /\.settings-modal-panel :is\(\.project-path, \.project-provider-badge, \.project-model-badge\) \{[\s\S]*background: rgba\(13, 28, 25, 0\.92\);[\s\S]*color: var\(--af-text-primary\);/);
  assert.match(settingsHtml, /\.settings-modal-panel \.project-path:first-of-type \{[\s\S]*color: var\(--fd-cyan\);/);
  assert.match(settingsHtml, /#shareAccessProjectPicker \.access-project-card \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\);/);
  assert.match(settingsHtml, /#shareAccessProjectPicker \.access-project-card-title \{[\s\S]*text-overflow: ellipsis;/);
  assert.match(settingsHtml, /#shareAccessProjectPicker \.access-project-card-path \{[\s\S]*font-family: "Cascadia Code"/);
  assert.match(settingsHtml, /option \{/);
  assert.match(settingsHtml, /color-scheme: dark/);
});

test("settings launcher stays a full-width card grid under the shared theme", () => {
  assert.match(flowDeckCss, /\.settings-shell \{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(flowDeckCss, /\.settings-nav \{[\s\S]*display: grid;[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(220px, 1fr\)\);/);
  assert.match(flowDeckCss, /\.settings-nav \{[\s\S]*position: static;/);
  assert.match(flowDeckCss, /\.settings-nav-item \{[\s\S]*min-height: 76px;/);
  assert.doesNotMatch(flowDeckCss, /\.settings-shell \{[\s\S]*grid-template-columns: 250px minmax\(0, 1fr\);/);
});

test("settings connection form hides manually edited agent ids", () => {
  assert.match(settingsHtml, /<input type="hidden" id="agentId">/);
  assert.doesNotMatch(settingsHtml, /id="agentIdLabel"/);
  assert.doesNotMatch(settingsHtml, /placeholder="Enter your agent ID"/);
  assert.doesNotMatch(settingsHtml, /agentId: document\.getElementById\("agentId"\)\.value\.trim\(\)/);
  assert.doesNotMatch(settingsHtml, /api\.login\(\{ username, password, agentId \}\)/);
  assert.doesNotMatch(settingsHtml, /\["serverUrl", "username", "password", "agentId", "githubToken"\]/);
});
