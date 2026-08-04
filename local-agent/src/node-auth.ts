import { safeStorage } from "electron";
import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";
import { fetchRelayJson } from "./relay-http";

export interface NodeConfig {
  serverUrl: string;
  agentId: string;
  username: string;
  encryptedToken: string;
}

const defaults: NodeConfig = {
  serverUrl: "wss://relay.liuyg.cn/ws",
  agentId: "",
  username: "",
  encryptedToken: "",
};

const store = new Store<NodeConfig>({ name: "node-config", defaults });

function encodeSecret(value: string): string {
  if (!value || !safeStorage.isEncryptionAvailable()) return value;
  return safeStorage.encryptString(value).toString("base64");
}

function decodeSecret(value: string): string {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) return value;
  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch {
    return "";
  }
}

function normalizeServerUrl(value: string): string {
  return value.trim() || defaults.serverUrl;
}

function toHttpBaseUrl(serverUrl: string): string {
  return normalizeServerUrl(serverUrl)
    .replace(/^wss:/i, "https:")
    .replace(/^ws:/i, "http:")
    .replace(/\/ws\/?$/i, "");
}

export function getNodeConfig(): Omit<NodeConfig, "encryptedToken"> & { token: string } {
  const agentId = store.get("agentId") || `field-node-${uuidv4()}`;
  if (!store.get("agentId")) store.set("agentId", agentId);
  return {
    serverUrl: normalizeServerUrl(store.get("serverUrl")),
    agentId,
    username: store.get("username") || "",
    token: decodeSecret(store.get("encryptedToken")),
  };
}

export async function loginFieldNode(input: { serverUrl: string; username: string; password: string }) {
  const current = getNodeConfig();
  const serverUrl = normalizeServerUrl(input.serverUrl);
  const username = input.username.trim();
  const password = input.password;
  if (!username || !password) throw new Error("Username and password are required.");
  const response = await fetchRelayJson(`${toHttpBaseUrl(serverUrl)}/api/auth/login`, {
    method: "POST",
    body: { username, password, client_type: "agent", client_id: current.agentId },
  });
  if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
  const result = await response.json() as { token?: string };
  if (!result.token) throw new Error("Relay did not return a node token.");
  store.set("serverUrl", serverUrl);
  store.set("username", username);
  store.set("encryptedToken", encodeSecret(result.token));
  return getNodeConfig();
}

export async function grantFieldNodeAccess(input: {
  controllerUsername: string;
  allowDiagnostics: boolean;
  allowFileDownload: boolean;
  allowOperate: boolean;
}) {
  const config = getNodeConfig();
  const controllerUsername = input.controllerUsername.trim();
  if (!config.token) throw new Error("Sign in to the field node first.");
  if (!controllerUsername) throw new Error("Controller username is required.");
  const response = await fetchRelayJson(`${toHttpBaseUrl(config.serverUrl)}/api/access/grants`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}` },
    body: {
      controller_username: controllerUsername,
      target_agent_id: config.agentId,
      scope_type: "all_projects",
      capability_bundle: input.allowOperate ? "operate" : "observe",
      allow_diagnostics: input.allowDiagnostics,
      allow_file_download: input.allowFileDownload,
      note: "Field node access",
    },
  });
  if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
}
