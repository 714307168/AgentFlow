const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const html = fs.readFileSync(path.join(__dirname, "../renderer/settings.html"), "utf8");
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
const main = fs.readFileSync(path.join(__dirname, "../src/main.ts"), "utf8");

// Execute the production functions, not a copy of the navigation state machine.
function functionsFrom(source, names) {
  const file = ts.createSourceFile("settings.ts", source, ts.ScriptTarget.Latest, true);
  return file.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map((node) => ts.transpile(node.getText(file))).join("\n");
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function element(dataset = {}, hidden = false) {
  const classes = new Set(hidden ? ["hidden"] : []);
  return {
    dataset, textContent: "", innerHTML: "", attributes: {},
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function harness() {
  const nodes = new Map();
  const panes = ["overview", "connection", "project", "runtime", "skills"].map((pane) => element({ paneContent: pane }, true));
  const menus = panes.map((pane) => element({ pane: pane.dataset.paneContent }));
  const loads = [], errors = [];
  const context = vm.createContext({
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, element({}, id === "settingsModal"));
        return nodes.get(id);
      },
      querySelectorAll: (selector) => selector === "[data-pane]" ? menus : panes,
    },
    activeSettingsPane: "system", settingsModalOpen: false, settingsPaneOpenRequest: 0,
    settingsInitializationPromise: Promise.resolve(),
    inlineText: (en) => en, getSettingsPaneTitle: (pane) => pane,
    applyPageChrome() {}, syncConnectionStatusPolling() {},
    updateConnectionStatus: async () => {}, updateLoginStatus: async () => {},
    ensurePaneDataLoaded: async (pane) => { loads.push(pane); },
    getErrorMessage: (error) => error.message, showStatus: (error) => errors.push(error),
  });
  vm.runInContext(functionsFrom(script, [
    "normalizeSettingsPane", "setSettingsModalLoading", "openSettingsModal",
    "closeSettingsModal", "setActiveSettingsPane", "initialize",
  ]), context);
  return { context, nodes, loads, errors, visible: () => panes.filter((p) => !p.classList.contains("hidden")).map((p) => p.dataset.paneContent) };
}

test("main and renderer keep the system launcher separate from runtime and overview", () => {
  for (const source of [main, script]) {
    const context = vm.createContext({});
    vm.runInContext(functionsFrom(source, ["normalizeSettingsPane"]), context);
    for (const pane of ["system", "runtime", "overview", "connection", "project", "skills"]) {
      assert.equal(context.normalizeSettingsPane(pane), pane);
    }
    assert.equal(context.normalizeSettingsPane(), "system");
    assert.equal(context.normalizeSettingsPane("invalid"), "system");
    assert.equal(context.normalizeSettingsPane("advanced"), "runtime");
    assert.equal(context.normalizeSettingsPane("message"), "transfer");
  }
  assert.match(script, /onSettingsPaneChanged\(\(pane\) => \{\s*void setActiveSettingsPane\(pane \|\| "system"\)/);
});

test("cold system menu opens the launcher without loading or showing a runtime modal", async () => {
  const h = harness();
  h.context.settingsInitializationPromise = deferred().promise;
  await h.context.setActiveSettingsPane("system");
  assert.equal(h.context.settingsModalOpen, false);
  assert.deepEqual(h.loads, []);
  assert.deepEqual(h.visible(), []);
});

test("initialization never overwrites a direct pane request", async () => {
  const h = harness(), ready = deferred();
  h.context.loadSettings = () => ready.promise;
  h.context.preloadSettingsPaneData = () => {};
  h.context.settingsInitializationPromise = h.context.initialize();
  const navigation = h.context.setActiveSettingsPane("connection");
  await Promise.resolve();
  assert.deepEqual(h.loads, []);
  assert.equal(h.context.settingsModalOpen, true);
  ready.resolve();
  await navigation;
  assert.equal(h.context.settingsModalOpen, true);
  assert.deepEqual(h.visible(), ["connection"]);
});

test("only the latest click during initialization is loaded", async () => {
  const h = harness(), ready = deferred();
  h.context.settingsInitializationPromise = ready.promise;
  const first = h.context.setActiveSettingsPane("connection");
  const second = h.context.setActiveSettingsPane("project");
  ready.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(h.loads, ["project"]);
  assert.deepEqual(h.visible(), ["project"]);
});

test("returning to the system menu cancels a pending pane open", async () => {
  const h = harness(), ready = deferred();
  h.context.settingsInitializationPromise = ready.promise;
  const first = h.context.setActiveSettingsPane("runtime");
  await h.context.setActiveSettingsPane("system");
  ready.resolve();
  await first;
  assert.equal(h.context.settingsModalOpen, false);
  assert.deepEqual(h.loads, []);
});

test("closing while data is loading is not undone by a late response", async () => {
  const h = harness(), data = deferred(), started = deferred();
  h.context.ensurePaneDataLoaded = () => { started.resolve(); return data.promise; };
  const first = h.context.setActiveSettingsPane("runtime");
  await started.promise;
  h.context.closeSettingsModal();
  data.resolve();
  await first;
  assert.equal(h.context.settingsModalOpen, false);
  assert.deepEqual(h.visible(), []);
});

test("a superseded connection status request cannot load a different pane or report a stale error", async () => {
  const h = harness(), status = deferred(), started = deferred();
  h.context.updateConnectionStatus = () => { started.resolve(); return status.promise; };
  const first = h.context.setActiveSettingsPane("connection");
  await started.promise;
  await h.context.setActiveSettingsPane("runtime");
  status.reject(new Error("old connection error"));
  await first;
  assert.deepEqual(h.loads, ["runtime"]);
  assert.deepEqual(h.visible(), ["runtime"]);
  assert.deepEqual(h.errors, []);
});

test("initialization failure is shown without exposing uninitialized forms", async () => {
  const h = harness(), ready = deferred();
  h.context.settingsInitializationPromise = ready.promise;
  const first = h.context.setActiveSettingsPane("runtime");
  ready.reject(new Error("configuration failed"));
  await first;
  assert.deepEqual(h.errors, ["configuration failed"]);
  assert.deepEqual(h.visible(), []);
  assert.equal(h.nodes.get("settingsModalBody").attributes["aria-busy"], "false");
});

test("runtime cards do not render missing errors before detection completes", () => {
  const h = harness();
  Object.assign(h.context, {
    latestCliProviderRuntimeStatus: null, latestConfig: null, currentLang: "en", providerUi: null,
    providerRuntimeApi: require("../renderer/settings-provider-runtime.js"),
    escapeHtml: (text) => text, formatProviderStatusCheckedAt: () => "Not checked yet",
    applyCliProviderAvailability() {},
  });
  vm.runInContext(functionsFrom(script, ["renderCliProviderRuntimeStatus"]), h.context);
  h.context.renderCliProviderRuntimeStatus();
  const markup = h.nodes.get("runtimeStatusGrid").innerHTML;
  assert.match(markup, /Awaiting detection/);
  assert.doesNotMatch(markup, /Runtime Missing|No usable local CLI|runtime-status-(pill|chip) error/);
  h.context.latestConfig = {};
  h.context.latestCliProviderRuntimeStatus = { codex: { installed: false } };
  h.context.renderCliProviderRuntimeStatus();
  assert.match(h.nodes.get("runtimeStatusGrid").innerHTML, /Runtime Missing/);
});
