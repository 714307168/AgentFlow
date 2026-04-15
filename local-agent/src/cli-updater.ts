import { execFile } from "child_process";
import { getProviderInstallTargets } from "./provider-registry";
import type { CliProvider } from "./runtime-types";

export type CliInstallMethod = "npm" | "brew" | "scoop" | "winget" | "unknown";

export interface CliUpgradeCommand {
  command: string;
  args: string[];
}

export interface CliUpgradePlan {
  available: boolean;
  required: boolean;
  installMethod: CliInstallMethod | null;
  command: CliUpgradeCommand | null;
  commandPreview: string | null;
  reason: string | null;
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
  if (!installMethod || installMethod === "unknown") {
    return null;
  }

  if (installMethod === "npm") {
    return {
      command: platform === "win32" ? "npm.cmd" : "npm",
      args: ["install", "-g", getCliPackageName(provider)],
    };
  }

  if (installMethod === "brew") {
    return {
      command: "brew",
      args: ["upgrade", getBrewFormulaName(provider)],
    };
  }

  if (installMethod === "scoop") {
    return {
      command: "scoop",
      args: ["update", getScoopPackageName(provider)],
    };
  }

  if (installMethod === "winget") {
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
): Promise<{ success: boolean; output: string; commandPreview: string | null; error?: string }> {
  const command = buildCliUpgradeCommand(provider, installMethod);
  const commandPreview = formatCliUpgradeCommandPreview(command);
  if (!command) {
    return {
      success: false,
      output: "",
      commandPreview,
      error: "Automatic CLI upgrade is not supported for this installation source.",
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
