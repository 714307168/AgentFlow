import { execFile } from "child_process";
import { getProviderInstallTargets } from "./provider-registry";
import type { CliProvider } from "./runtime-types";
import { appendNpmRegistryArgs, buildNpmCommandEnvironment } from "./npm-network";
import { getNpmCommand, isNpmCommandAvailable } from "./npm-package-manager";

export type CliInstallMethod = "npm" | "brew" | "scoop" | "winget" | "unknown";
export type CliMaintenanceAction = "install" | "upgrade";

export interface CliUpgradeCommand {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export interface CliUpgradePlan {
  available: boolean;
  required: boolean;
  installMethod: CliInstallMethod | null;
  command: CliUpgradeCommand | null;
  commandPreview: string | null;
  reason: string | null;
  latestVersion: string | null;
}

export interface CliMaintenanceResult {
  success: boolean;
  output: string;
  commandPreview: string | null;
  error?: string;
  skipped?: boolean;
}

const CLI_UPGRADE_TIMEOUT_MS = 10 * 60 * 1000;
const CLI_UPGRADE_MAX_BUFFER = 256 * 1024;

export function detectCliInstallMethod(
  resolvedPath: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
): CliInstallMethod | null {
  const normalizedPath = String(resolvedPath ?? "").trim().replace(/\\/g, "/").toLowerCase();
  if (!normalizedPath) {
    return null;
  }

  if (normalizedPath.includes("/scoop/")) {
    return "scoop";
  }
  if (normalizedPath.includes("/windowsapps/")) {
    return "winget";
  }
  if (normalizedPath.includes("/homebrew/")
    || normalizedPath.startsWith("/opt/homebrew/")
    || normalizedPath.startsWith("/usr/local/homebrew/")) {
    return "brew";
  }
  if (normalizedPath.includes("/node_modules/")
    || normalizedPath.includes("/nodejs/")
    || normalizedPath.includes("/nvm/")
    || normalizedPath.includes("/npm/")) {
    return "npm";
  }
  if (platform === "win32" && normalizedPath.endsWith("/codex.cmd")) {
    return "npm";
  }
  if (platform === "win32" && normalizedPath.endsWith("/claude.cmd")) {
    return "npm";
  }

  return "unknown";
}

export function buildCliUpgradeCommand(
  provider: CliProvider,
  installMethod: CliInstallMethod | null,
  platform: NodeJS.Platform = process.platform,
): CliUpgradeCommand | null {
  return buildCliMaintenanceCommand(provider, installMethod, "upgrade", platform);
}

export function buildCliInstallCommand(
  provider: CliProvider,
  platform: NodeJS.Platform = process.platform,
): CliUpgradeCommand {
  return buildCliMaintenanceCommand(provider, "npm", "install", platform)!;
}

export function buildCliMaintenanceCommand(
  provider: CliProvider,
  installMethod: CliInstallMethod | null,
  action: CliMaintenanceAction,
  platform: NodeJS.Platform = process.platform,
): CliUpgradeCommand | null {
  if (!installMethod || installMethod === "unknown") {
    return null;
  }

  if (installMethod === "npm") {
    return {
      command: getNpmCommand(platform),
      args: appendNpmRegistryArgs(["install", "-g", getCliPackageName(provider)]),
      env: buildNpmCommandEnvironment(),
    };
  }

  if (installMethod === "brew") {
    if (action === "install") {
      return {
        command: "brew",
        args: ["install", getBrewFormulaName(provider)],
      };
    }
    return {
      command: "brew",
      args: ["upgrade", getBrewFormulaName(provider)],
    };
  }

  if (installMethod === "scoop") {
    if (action === "install") {
      return {
        command: "scoop",
        args: ["install", getScoopPackageName(provider)],
      };
    }
    return {
      command: "scoop",
      args: ["update", getScoopPackageName(provider)],
    };
  }

  if (installMethod === "winget") {
    if (action === "install") {
      return {
        command: "winget",
        args: [
          "install",
          "--id",
          getWingetPackageId(provider),
          "--accept-source-agreements",
          "--accept-package-agreements",
        ],
      };
    }
    return {
      command: "winget",
      args: [
        "upgrade",
        "--id",
        getWingetPackageId(provider),
        "--accept-source-agreements",
        "--accept-package-agreements",
      ],
    };
  }

  return null;
}

export function formatCliUpgradeCommandPreview(command: CliUpgradeCommand | null): string | null {
  if (!command) {
    return null;
  }
  return [command.command, ...command.args]
    .map((part) => (/\s/u.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part))
    .join(" ");
}

export async function upgradeCliProvider(
  provider: CliProvider,
  installMethod: CliInstallMethod | null,
): Promise<CliMaintenanceResult> {
  return await maintainCliProvider(provider, installMethod, "upgrade");
}

export async function installCliProvider(
  provider: CliProvider,
): Promise<CliMaintenanceResult> {
  return await maintainCliProvider(provider, "npm", "install");
}

export async function maintainCliProvider(
  provider: CliProvider,
  installMethod: CliInstallMethod | null,
  action: CliMaintenanceAction,
  options: { packageManagerAvailable?: boolean } = {},
): Promise<CliMaintenanceResult> {
  const command = buildCliMaintenanceCommand(provider, installMethod, action);
  const commandPreview = formatCliUpgradeCommandPreview(command);
  if (!command) {
    return {
      success: false,
      output: "",
      commandPreview,
      error: `Automatic CLI ${action} is not supported for this installation source.`,
    };
  }
  const packageManagerAvailable = options.packageManagerAvailable
    ?? await isNpmCommandAvailable();
  if (installMethod === "npm" && !packageManagerAvailable) {
    return {
      success: false,
      skipped: true,
      output: "",
      commandPreview,
      error: `Automatic CLI ${action} requires npm, but npm is not available in PATH.`,
    };
  }

  return await new Promise((resolve) => {
    execFile(
      command.command,
      command.args,
      {
        timeout: CLI_UPGRADE_TIMEOUT_MS,
        maxBuffer: CLI_UPGRADE_MAX_BUFFER,
        windowsHide: true,
        env: command.env,
      },
      (error, stdout, stderr) => {
        const output = [stdout, stderr]
          .map((part) => String(part ?? "").trim())
          .filter(Boolean)
          .join("\n")
          .trim();
        if (error) {
          resolve({
            success: false,
            output,
            commandPreview,
            error: error.message,
          });
          return;
        }
        resolve({
          success: true,
          output,
          commandPreview,
        });
      },
    );
  });
}

function getCliPackageName(provider: CliProvider): string {
  return getProviderInstallTargets(provider).npm;
}

function getBrewFormulaName(provider: CliProvider): string {
  return getProviderInstallTargets(provider).brew;
}

function getScoopPackageName(provider: CliProvider): string {
  return getProviderInstallTargets(provider).scoop;
}

function getWingetPackageId(provider: CliProvider): string {
  return getProviderInstallTargets(provider).winget;
}
