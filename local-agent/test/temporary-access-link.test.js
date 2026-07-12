const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mainTs = fs.readFileSync(path.join(__dirname, "../src/main.ts"), "utf8");
const preloadTs = fs.readFileSync(path.join(__dirname, "../src/preload.ts"), "utf8");
const terminalTs = fs.readFileSync(path.join(__dirname, "../renderer/terminal.ts"), "utf8");
const stylesCss = fs.readFileSync(path.join(__dirname, "../renderer/styles.css"), "utf8");

test("desktop can request temporary access links through main process IPC", () => {
  assert.match(mainTs, /interface TemporaryAccessLinkCreateOptions/);
  assert.match(mainTs, /createTemporaryAccessLinkOnServer/);
  assert.match(mainTs, /\/api\/access\/temp-links/);
  assert.match(mainTs, /ipcMain\.handle\("create-temporary-access-link"/);
  assert.match(preloadTs, /createTemporaryAccessLink/);
  assert.match(preloadTs, /ipcRenderer\.invoke\('create-temporary-access-link'/);
});

test("project list exposes a temporary API context menu and dialog", () => {
  assert.match(terminalTs, /addEventListener\("contextmenu"/);
  assert.match(terminalTs, /Share temporary API/);
  assert.match(terminalTs, /分享临时 API/);
  assert.match(terminalTs, /data-share-temp-api/);
  assert.match(terminalTs, /name="maxUses"/);
  assert.match(terminalTs, /name="expiresInHours"/);
  assert.match(terminalTs, /createTemporaryAccessLinkFromDialog/);
  assert.match(terminalTs, /Temporary API link created and copied/);
});

test("temporary access menu and dialog use dark AgentFlow surfaces", () => {
  assert.match(stylesCss, /\.temporary-access-menu \{/);
  assert.match(stylesCss, /\.temporary-access-dialog \{/);
  assert.match(stylesCss, /\.temporary-access-card \{[\s\S]*background: linear-gradient/);
  assert.match(stylesCss, /\.temporary-access-field input,/);
  assert.match(stylesCss, /\.temporary-access-result textarea/);
});
