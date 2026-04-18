import { execFile } from "child_process";
import type { CliInstallMethod } from "./cli-updater";
import { getProviderInstallTargets } from "./provider-registry";
import type { CliProvider } from "./runtime-types";
import { normalizeCliVersionOutput } from "./cli-version";

const CLI_VERSION_QUERY_TIMEOUT_MS = 8_000;
const CLI_VERSION_QUERY_MAX_BUFFER = 128 * 1024;

export async function detectCliProviderLatestVersion(
  provider: CliProvider,
  installMethod: CliInstallMethod | null,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (!installMethod || installMethod === "unknown") {
    return null;
  }

  const targets = getProviderInstallTargets(provider);
  try {
    if (installMethod === "npm") {
      const packageName = targets.npm.replace(/@latest$/u, "");
      const result = await runCommand(platform === "win32" ? "npm.cmd" : "npm", ["view", packageName, "version", "--json"]);
      return parseNpmLatestVersion(result.stdout, result.stderr);
    }

    if (installMethod === "brew") {
      const result = await runCommand("brew", ["info", "--json=v2", targets.brew]);
      return parseBrewLatestVersion(result.stdout);
    }

    if (installMethod === "winget") {
      const result = await runCommand("winget", [
        "upgrade",
        "--id",
        targets.winget,
        "--exact",
        "--disable-interactivity",
        "--accept-source-agreements",
        "--accept-package-agreements",
      ]);
      return parseWingetLatestVersion(result.stdout, result.stderr, targets.winget);
    }

    if (installMethod === "scoop") {
      const result = await runCommand("scoop", ["status"]);
      return parseScoopLatestVersion(result.stdout, result.stderr, targets.scoop);
    }
  } catch {
    return null;
  }

  return null;
}

export function parseNpmLatestVersion(stdout: string, stderr = ""): string | null {
  const normalized = normalizeCliVersionOutput(stdout, stderr);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized);
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : normalized;
  } catch {
    return normalized;
  }
}

export function parseBrewLatestVersion(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { formulae?: Array<{ versions?: { stable?: string | null } }> };
    const stableVersion = parsed.formulae?.[0]?.versions?.stable;
    return typeof stableVersion === "string" && stableVersion.trim() ? stableVersion.trim() : null;
  } catch {
    return null;
  }
}

export function parseWingetLatestVersion(stdout: string, stderr: string, packageId: string): string | null {
  const combinedOutput = [stdout, stderr]
    .map((part) => String(part ?? ""))
    .filter(Boolean)
    .join("\n");
  const escapedPackageId = packageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escapedPackageId + "\\s+\\S+\\s+(\\S+)(?:\\s+\\S+)?$", "imu");
  const match = combinedOutput.match(pattern);
  return match?.[1] || null;
}

export function parseScoopLatestVersion(stdout: string, stderr: string, packageName: string): string | null {
  const combinedOutput = [stdout, stderr]
    .map((part) => String(part ?? ""))
    .filter(Boolean)
    .join("\n");
  const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("^" + escapedPackageName + "\\s+\\S+\\s+->\\s+(\\S+)$", "imu");
  const match = combinedOutput.match(pattern);
  return match?.[1] || null;
}

function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: CLI_VERSION_QUERY_TIMEOUT_MS,
        maxBuffer: CLI_VERSION_QUERY_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}
