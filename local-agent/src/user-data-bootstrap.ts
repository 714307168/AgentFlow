import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

const STABLE_USER_DATA_DIR = "claude-code-agent";
const LEGACY_DEV_USER_DATA_DIR = "Electron";
const BOOTSTRAP_SETTINGS_FILE = "bootstrap-settings.json";
const STORE_FILES = [
  "config.json",
  "app-settings.json",
  "i18n.json",
  "runtime-sessions.json",
  "window-state.json",
  "workgroups.json",
  "workgroup-collaborations.json",
] as const;
const MANAGED_DIRECTORIES = [
  "logs",
  "runtime-history",
  "runtime-attachments",
  "updates",
  "workgroup-plans",
] as const;

type ConfigShape = {
  agentId?: string;
  token?: string;
  encryptedToken?: string;
  username?: string;
  projects?: unknown[];
};

type BootstrapSettingsShape = {
  localDataRoot?: string | null;
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
      (typeof config.encryptedToken === "string" && config.encryptedToken.trim()) ||
      (typeof config.username === "string" && config.username.trim()) ||
      (Array.isArray(config.projects) && config.projects.length > 0),
  );
}

function normalizeAbsolutePath(rawPath: string): string {
  const resolved = path.resolve(rawPath);
  return process.platform === "win32"
    ? resolved.replace(/\//g, "\\").toLowerCase()
    : resolved;
}

function isSamePath(left: string, right: string): boolean {
  return normalizeAbsolutePath(left) === normalizeAbsolutePath(right);
}

function ensureDirectory(targetPath: string): void {
  fs.mkdirSync(targetPath, { recursive: true });
}

function getDefaultLocalDataRoot(): string {
  return path.join(app.getPath("appData"), STABLE_USER_DATA_DIR);
}

function getBootstrapSettingsPath(): string {
  return path.join(getDefaultLocalDataRoot(), BOOTSTRAP_SETTINGS_FILE);
}

function readBootstrapSettings(): BootstrapSettingsShape | null {
  return readJson<BootstrapSettingsShape>(getBootstrapSettingsPath());
}

function writeBootstrapSettings(settings: BootstrapSettingsShape): void {
  ensureDirectory(getDefaultLocalDataRoot());
  fs.writeFileSync(getBootstrapSettingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

function copyManagedEntry(sourcePath: string, targetPath: string): void {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, targetPath, {
      recursive: true,
      force: true,
      errorOnExist: false,
      preserveTimestamps: true,
    });
    return;
  }

  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

function copyManagedChildren(sourceRoot: string, targetRoot: string): void {
  if (!fs.existsSync(sourceRoot)) {
    return;
  }

  ensureDirectory(targetRoot);

  for (const fileName of STORE_FILES) {
    const sourcePath = path.join(sourceRoot, fileName);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    copyManagedEntry(sourcePath, path.join(targetRoot, fileName));
  }

  for (const directoryName of MANAGED_DIRECTORIES) {
    const sourcePath = path.join(sourceRoot, directoryName);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }
    copyManagedEntry(sourcePath, path.join(targetRoot, directoryName));
  }
}

function getConfiguredLocalDataRoot(): string {
  const configuredPath = readBootstrapSettings()?.localDataRoot;
  const trimmed = typeof configuredPath === "string" ? configuredPath.trim() : "";
  return trimmed ? path.resolve(trimmed) : getDefaultLocalDataRoot();
}

export function getPersistedLocalDataRoot(): string {
  return getConfiguredLocalDataRoot();
}

function migrateLegacyUserDataIfNeeded(targetRoot: string): void {
  const legacyUserDataPath = path.join(app.getPath("appData"), LEGACY_DEV_USER_DATA_DIR);

  if (!fs.existsSync(legacyUserDataPath)) {
    return;
  }

  const targetConfig = readJson<ConfigShape>(path.join(targetRoot, "config.json"));
  const legacyConfig = readJson<ConfigShape>(path.join(legacyUserDataPath, "config.json"));

  if (hasUsefulConfig(targetConfig) || !hasUsefulConfig(legacyConfig)) {
    return;
  }

  copyManagedChildren(legacyUserDataPath, targetRoot);
}

function ensureStableUserDataPath(): void {
  const currentUserDataPath = app.getPath("userData");
  const effectiveUserDataPath = getConfiguredLocalDataRoot();

  if (!isSamePath(currentUserDataPath, effectiveUserDataPath)) {
    app.setPath("userData", effectiveUserDataPath);
  }

  migrateLegacyUserDataIfNeeded(effectiveUserDataPath);
}

export function resolveLocalDataRoot(rawPath?: string | null): string {
  const trimmed = String(rawPath ?? "").trim();
  return trimmed ? path.resolve(trimmed) : getDefaultLocalDataRoot();
}

export function getCurrentLocalDataRoot(): string {
  return app.getPath("userData");
}

export function localDataRootsEqual(left: string, right: string): boolean {
  return isSamePath(left, right);
}

export function persistLocalDataRoot(nextRoot?: string | null): string {
  const resolvedRoot = resolveLocalDataRoot(nextRoot);
  const defaultRoot = getDefaultLocalDataRoot();

  if (isSamePath(resolvedRoot, defaultRoot)) {
    writeBootstrapSettings({ localDataRoot: null });
    return defaultRoot;
  }

  writeBootstrapSettings({ localDataRoot: resolvedRoot });
  return resolvedRoot;
}

export function migrateLocalDataRoot(currentRoot: string, nextRoot: string): void {
  if (isSamePath(currentRoot, nextRoot)) {
    return;
  }

  copyManagedChildren(currentRoot, nextRoot);
}

ensureStableUserDataPath();

export { getDefaultLocalDataRoot };
