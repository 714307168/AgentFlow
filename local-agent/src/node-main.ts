import { app, BrowserWindow, ipcMain } from "electron";
import * as os from "os";
import RelayClient from "./relay-client";
import { collectFieldNodeDiagnostics } from "./field-node-diagnostics";
import fieldNodeStore from "./field-node-store";
import { getNodeConfig, grantFieldNodeAccess, loginFieldNode } from "./node-auth";
import { Events } from "./types";
import { v4 as uuidv4 } from "uuid";
import { isFieldNodeCommandAction, runFieldNodeCommand } from "./field-node-command";

app.setName("AgentFlow Node");

let window: BrowserWindow | null = null;
let relay: RelayClient | null = null;
let connectionState = "disconnected";

function publishState(): void {
  if (!window || window.isDestroyed()) return;
  const config = getNodeConfig();
  window.webContents.send("node-state", {
    connected: connectionState === "connected",
    connectionState,
    serverUrl: config.serverUrl,
    agentId: config.agentId,
    username: config.username,
    profile: fieldNodeStore.getProfile(),
  });
}

function sendNodeResponse(event: string, request: Record<string, unknown>, payload: Record<string, unknown>): void {
  const controllerDeviceId = String(request.controller_device_id ?? "").trim();
  const requestId = String(request.request_id ?? "").trim();
  if (!relay || !controllerDeviceId || !requestId) return;
  const config = getNodeConfig();
  const profile = fieldNodeStore.getProfile();
  relay.send({
    id: uuidv4(), event, ts: Date.now(),
    payload: {
      agent_id: config.agentId,
      controller_device_id: controllerDeviceId,
      request_id: requestId,
      profile: {
        node_id: config.agentId,
        kind: profile.kind,
        display_name: profile.displayName || os.hostname(),
        location: profile.location,
        diagnostics_enabled: profile.diagnosticsEnabled,
      },
      ...payload,
    },
  });
}

function connectRelay(): void {
  const config = getNodeConfig();
  relay?.disconnect();
  relay = null;
  if (!config.token) {
    connectionState = "signed_out";
    publishState();
    return;
  }
  relay = new RelayClient(config.serverUrl, config.agentId, config.token, true);
  relay.on("connection-state-changed", (snapshot: { state?: string }) => {
    connectionState = snapshot.state || "disconnected";
    publishState();
  });
  relay.on("authenticated", () => {
    connectionState = "connected";
    publishState();
  });
  relay.on("message", (env: { event?: string; payload?: unknown }) => {
    const request = (env.payload ?? {}) as Record<string, unknown>;
    if (env.event === Events.NODE_PROFILE_REQUEST) {
      sendNodeResponse(Events.NODE_PROFILE, request, {});
    }
    if (env.event === Events.NODE_DIAGNOSTICS_REQUEST) {
      sendNodeResponse(Events.NODE_DIAGNOSTICS, request, {
        diagnostics: collectFieldNodeDiagnostics(fieldNodeStore.getProfile()),
      });
    }
    if (env.event === Events.NODE_COMMAND_REQUEST) {
      const action = request.action;
      if (!isFieldNodeCommandAction(action)) {
        sendNodeResponse(Events.NODE_COMMAND_RESULT, request, { result: { action: String(action ?? ""), ok: false, output: "Unsupported field-node action.", executedAt: Date.now() } });
        return;
      }
      void runFieldNodeCommand(action).then((result) => sendNodeResponse(Events.NODE_COMMAND_RESULT, request, { result }));
    }
  });
  connectionState = "connecting";
  relay.connect();
  publishState();
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 460,
    height: 650,
    resizable: false,
    webPreferences: { preload: __dirname + "/node-preload.js", contextIsolation: true, nodeIntegration: false },
  });
  void window.loadFile(__dirname + "/../renderer/node.html");
}

ipcMain.handle("node:get-state", () => ({ ...getNodeConfig(), profile: fieldNodeStore.getProfile(), connected: connectionState === "connected", connectionState }));
ipcMain.handle("node:save-profile", (_event, profile) => fieldNodeStore.saveProfile(profile));
ipcMain.handle("node:login", async (_event, input) => {
  await loginFieldNode(input);
  connectRelay();
  return { success: true };
});
ipcMain.handle("node:grant-access", async (_event, input) => {
  await grantFieldNodeAccess(input);
  return { success: true };
});
ipcMain.handle("node:reconnect", () => { connectRelay(); return { success: true }; });

app.whenReady().then(() => {
  createWindow();
  connectRelay();
});
app.on("window-all-closed", () => app.quit());
