import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const STABLE_USER_DATA_DIR = "claude-code-agent";
export const BOOTSTRAP_SETTINGS_FILE = "bootstrap-settings.json";

interface BootstrapSettingsShape {
  localDataRoot?: string | null;
}

function readBootstrapSettings(filePath: string): BootstrapSettingsShape | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as BootstrapSettingsShape;
  } catch (_error) {
    return null;
  }
}

function resolveAppDataRoot(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();

  if (platform === "win32") {
    return env.APPDATA?.trim()
      || path.join(homeDir, "AppData", "Roaming");
  }

  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support");
  }

  return env.XDG_CONFIG_HOME?.trim()
    || path.join(homeDir, ".config");
}

export function getDefaultLocalDataRootForEnvironment(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): string {
  return path.join(resolveAppDataRoot(options), STABLE_USER_DATA_DIR);
}

export function getBootstrapSettingsPathForEnvironment(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): string {
  return path.join(getDefaultLocalDataRootForEnvironment(options), BOOTSTRAP_SETTINGS_FILE);
}

export function getPersistedLocalDataRootForEnvironment(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): string {
  const defaultRoot = getDefaultLocalDataRootForEnvironment(options);
  const settings = readBootstrapSettings(getBootstrapSettingsPathForEnvironment(options));
  const configuredPath = String(settings?.localDataRoot ?? "").trim();
  return configuredPath ? path.resolve(configuredPath) : defaultRoot;
}
