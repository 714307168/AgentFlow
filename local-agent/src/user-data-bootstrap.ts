import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

const STABLE_USER_DATA_DIR = "claude-code-agent";
const LEGACY_DEV_USER_DATA_DIR = "Electron";
const STORE_FILES = [
  "config.json",
  "app-settings.json",
  "i18n.json",
  "runtime-sessions.json",
] as const;

type ConfigShape = {
  agentId?: string;
  token?: string;
  username?: string;
  projects?: unknown[];
};

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (_error) {
    return null;
  }
}

function hasUsefulConfig(config: ConfigShape | null): boolean {
  if (!config || typeof config !== "object") {
    return false;
  }

  return Boolean(
    (typeof config.agentId === "string" && config.agentId.trim()) ||
      (typeof config.token === "string" && config.token.trim()) ||
      (typeof config.username === "string" && config.username.trim()) ||
      (Array.isArray(config.projects) && config.projects.length > 0),
  );
}

function ensureStableUserDataPath(): void {
  const currentUserDataPath = app.getPath("userData");
  const appDataRoot = path.dirname(currentUserDataPath);
  const stableUserDataPath = path.join(appDataRoot, STABLE_USER_DATA_DIR);
  const legacyUserDataPath = path.join(appDataRoot, LEGACY_DEV_USER_DATA_DIR);

  if (currentUserDataPath !== stableUserDataPath) {
    app.setPath("userData", stableUserDataPath);
  }

  if (!fs.existsSync(legacyUserDataPath)) {
    return;
  }

  fs.mkdirSync(stableUserDataPath, { recursive: true });

  const stableConfigPath = path.join(stableUserDataPath, "config.json");
  const legacyConfigPath = path.join(legacyUserDataPath, "config.json");
  const stableConfig = readJson<ConfigShape>(stableConfigPath);
  const legacyConfig = readJson<ConfigShape>(legacyConfigPath);

  if (hasUsefulConfig(stableConfig) || !hasUsefulConfig(legacyConfig)) {
    return;
  }

  for (const fileName of STORE_FILES) {
    const sourcePath = path.join(legacyUserDataPath, fileName);
    const targetPath = path.join(stableUserDataPath, fileName);

    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

ensureStableUserDataPath();
