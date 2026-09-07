// Run against an isolated Chrome CDP session; all Electron APIs are read-only fixtures.
// node scripts/check-settings-navigation.cjs [port]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const WebSocket = require("ws");

function installFixture() {
  let releaseRuntime;
  const runtime = new Promise((resolve) => { releaseRuntime = resolve; });
  window.finishRuntimeDetection = () => releaseRuntime({
    claude: { installed: true, version: "test", capabilities: { promptExecution: true } },
    codex: { installed: true, version: "test", capabilities: { promptExecution: true } },
  });
  window.claudeAgent = {
    getConfig: async () => ({ serverUrl: "", username: "", agentId: "test", cliProvider: "codex" }),
    getE2EStatus: async () => ({ enabled: true }), getLang: async () => "zh",
    getI18nMessages: async () => ({}), getAppSettings: async () => ({}),
    getUpdateState: async () => ({ status: "idle", currentVersion: "test" }),
    getCliProviderRuntimeStatus: () => runtime,
    getFieldNodeProfile: async () => ({ kind: "standard" }), listLocalCommands: async () => [],
    getProjects: async () => [], getLocalDataMetrics: async () => ({}),
    listScheduledTasks: async () => ({ tasks: [] }), listWorkgroups: async () => ({ workgroups: [] }),
    listAccessGrants: async () => ({ success: true, data: {} }),
    listRelayDevices: async () => ({ success: true, devices: [] }),
    listRelayTransfers: async () => ({ success: true, transfers: [] }),
    listSkillCatalog: async () => ({ items: [], scannedRoots: [] }),
    getConnectionStatus: async () => ({ state: "disconnected" }),
    onSettingsPaneChanged(callback) {
      window.openTestSettings = callback;
      setTimeout(() => callback(location.hash.slice(1) || "system"), 0);
    },
  };
  window.observedRuntimeFrames = 0;
  function watch() {
    const pane = document.getElementById("runtimePane");
    if (pane?.getBoundingClientRect().height > 0) window.observedRuntimeFrames += 1;
    requestAnimationFrame(watch);
  }
  requestAnimationFrame(watch);
}

async function main() {
  const endpoint = `http://127.0.0.1:${Number(process.argv[2] || 9222)}`;
  const page = await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  let nextId = 0;
  const pending = new Map(), errors = [];
  ws.on("message", (raw) => {
    const message = JSON.parse(raw);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      errors.push(message.params.args.map((arg) => arg.value || arg.description).join(" "));
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(expression) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error(`Condition timed out: ${expression}`);
  }
  const output = path.resolve(__dirname, "../../artifacts/settings-navigation");
  async function screenshot(name) {
    const data = await send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(data.data, "base64"));
  }
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `(${installFixture.toString()})()` });
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const url = pathToFileURL(path.resolve(__dirname, "../renderer/settings.html")).href;
    await send("Page.navigate", { url });
    await until("typeof openTestSettings === 'function' && typeof settingsInitializationPromise !== 'undefined'");
    await delay(300);
    assert.equal(await evaluate("settingsModalOpen"), false);
    assert.equal(await evaluate("observedRuntimeFrames"), 0);
    await evaluate("finishRuntimeDetection(); settingsInitializationPromise");
    await screenshot("system-menu");
    assert.equal(await evaluate("settingsModalOpen"), false);
    assert.equal(await evaluate("observedRuntimeFrames"), 0);

    for (const pane of ["runtime", "connection", "project"]) {
      await evaluate(`document.querySelector('[data-pane="${pane}"]').click()`);
      await until(`document.getElementById('${pane}Pane').getBoundingClientRect().height > 0`);
      await evaluate("document.getElementById('settingsModalCloseBtn').click()");
      assert.equal(await evaluate("settingsModalOpen"), false);
    }
    await send("Page.navigate", { url: `${url}?cold=runtime#runtime` });
    await until("typeof openTestSettings === 'function' && settingsModalOpen");
    await delay(300);
    assert.equal(await evaluate("observedRuntimeFrames"), 0);
    await evaluate("finishRuntimeDetection(); settingsInitializationPromise");
    await until("document.getElementById('runtimePane').getBoundingClientRect().height > 0");
    await delay(300);
    assert.equal(await evaluate("settingsModalOpen"), true);
    await screenshot("runtime-ready");
    await evaluate("openTestSettings('system')");
    assert.equal(await evaluate("settingsModalOpen"), false);

    await send("Page.navigate", { url: `${url}?cold=connection#connection` });
    await until("typeof openTestSettings === 'function' && settingsModalOpen");
    await evaluate("openTestSettings('project'); openTestSettings('runtime'); finishRuntimeDetection()");
    await until("document.getElementById('runtimePane').getBoundingClientRect().height > 0");
    assert.equal(await evaluate("activeSettingsPane"), "runtime");
    await evaluate("document.getElementById('settingsModalCloseBtn').click()");
    await delay(300);
    assert.equal(await evaluate("settingsModalOpen"), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, scenarios: 8, screenshots: output }));
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    ws.close();
    await fetch(`${endpoint}/json/close/${page.id}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
