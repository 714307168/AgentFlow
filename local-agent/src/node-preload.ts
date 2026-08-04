import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("nodeApi", {
  getState: () => ipcRenderer.invoke("node:get-state"),
  login: (input: { serverUrl: string; username: string; password: string }) => ipcRenderer.invoke("node:login", input),
  saveProfile: (profile: Record<string, unknown>) => ipcRenderer.invoke("node:save-profile", profile),
  grantAccess: (input: Record<string, unknown>) => ipcRenderer.invoke("node:grant-access", input),
  reconnect: () => ipcRenderer.invoke("node:reconnect"),
  onState: (callback: (state: unknown) => void) => ipcRenderer.on("node-state", (_event, state) => callback(state)),
});
