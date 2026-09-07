const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { buildLoginItemArgs } = require("../dist/src/desktop-launch-mode.js");

const source = fs.readFileSync(path.join(__dirname, "../src/main.ts"), "utf8");
const parsed = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
const settingsHandlers = ["get-app-settings", "set-app-settings"];
const statements = parsed.statements.filter((node) => {
  if (ts.isFunctionDeclaration(node)) return node.name?.text === "syncLoginItemSettings";
  const call = node.expression;
  return call && ts.isCallExpression(call) && call.expression.getText(parsed) === "ipcMain.handle"
    && settingsHandlers.includes(call.arguments[0]?.text);
});
const productionCode = ts.transpile(statements.map((node) => node.getText(parsed)).join("\n"));

function createHarness(isPackaged, autoStart = true, silentLaunch = true) {
  const values = new Map(Object.entries({ autoStart, silentLaunch }));
  const writes = [], loginItems = [], handlers = new Map();
  const context = vm.createContext({
    app: { isPackaged, setLoginItemSettings: (options) => loginItems.push(JSON.parse(JSON.stringify(options))) },
    appSettingsStore: {
      get: (name) => values.get(name),
      set: (name, value) => { writes.push({ name, value }); values.set(name, value); },
    },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    buildLoginItemArgs,
    getPersistedLocalDataRoot: () => "test-data", syncLocalDataRootSetting() {},
    getDefaultLocalDataRoot: () => "test-data", appLogger: { getLogDirectory: () => "test-logs" },
  });
  vm.runInContext(productionCode, context);
  return { context, handlers, values, writes, loginItems };
}

test("development startup never registers or deletes OS login items", () => {
  for (const autoStart of [false, true]) {
    for (const silentLaunch of [false, true]) {
      const h = createHarness(false, autoStart, silentLaunch);
      h.context.syncLoginItemSettings();
      assert.deepEqual(h.loginItems, []);
      assert.deepEqual(h.writes, []);
    }
  }
});

test("packaged startup preserves enabled, disabled, silent and visible login settings", () => {
  for (const autoStart of [false, true]) {
    for (const silentLaunch of [false, true]) {
      const h = createHarness(true, autoStart, silentLaunch);
      h.context.syncLoginItemSettings();
      assert.deepEqual(h.loginItems, [{ openAtLogin: autoStart, args: silentLaunch ? ["--hidden"] : [] }]);
    }
  }
});

test("development settings report autostart as unavailable without changing installed preferences", () => {
  const h = createHarness(false);
  const settings = h.handlers.get("get-app-settings")();
  assert.equal(settings.autoStart, false);
  assert.equal(settings.autoStartSupported, false);
  assert.equal(h.values.get("autoStart"), true);
  assert.deepEqual(h.writes, []);
});

test("packaged settings expose the saved autostart preference", () => {
  const h = createHarness(true);
  const settings = h.handlers.get("get-app-settings")();
  assert.equal(settings.autoStart, true);
  assert.equal(settings.autoStartSupported, true);
});

test("direct IPC requests cannot enable or disable autostart from a development build", () => {
  for (const autoStart of [false, true]) {
    const h = createHarness(false);
    assert.equal(h.handlers.get("set-app-settings")({}, { autoStart }), false);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.loginItems, []);
  }
});

test("changing silent launch in development does not register Electron", () => {
  const h = createHarness(false);
  assert.equal(h.handlers.get("set-app-settings")({}, { silentLaunch: false }), true);
  assert.deepEqual(h.writes, [{ name: "silentLaunch", value: false }]);
  assert.deepEqual(h.loginItems, []);
});

test("packaged IPC updates persist and synchronize the installed app login item", () => {
  const h = createHarness(true);
  assert.equal(h.handlers.get("set-app-settings")({}, { autoStart: false, silentLaunch: false }), true);
  assert.equal(h.values.get("autoStart"), false);
  assert.deepEqual(h.loginItems, [{ openAtLogin: false, args: [] }]);
});

test("autostart control is disabled only when the backend explicitly marks it unsupported", () => {
  const html = fs.readFileSync(path.join(__dirname, "../renderer/settings.html"), "utf8");
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const file = ts.createSourceFile("settings.js", script, ts.ScriptTarget.Latest, true);
  const fn = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name.text === "applyAutoStartAvailability");
  const toggle = { checked: true }, label = {};
  const context = vm.createContext({
    document: { getElementById: (id) => id === "autoStartToggle" ? toggle : label },
    latestAppSettings: { autoStartSupported: false }, inlineText: (en) => en,
  });
  vm.runInContext(fn.getText(file), context);
  context.applyAutoStartAvailability();
  assert.equal(toggle.disabled, true);
  assert.equal(toggle.checked, false);
  assert.match(label.title, /installed app only/);
  for (const settings of [{ autoStartSupported: true }, {}]) {
    context.latestAppSettings = settings;
    toggle.checked = true;
    context.applyAutoStartAvailability();
    assert.equal(toggle.disabled, false);
    assert.equal(toggle.checked, true);
    assert.equal(label.title, "");
  }
});
