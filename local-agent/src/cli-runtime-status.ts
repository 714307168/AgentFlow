import { execFile } from "child_process";
import { detectCliProviderLatestVersion } from "./cli-latest-version";
import { buildCliUpgradeCommand, detectCliInstallMethod, formatCliUpgradeCommandPreview, type CliInstallMethod, type CliUpgradePlan } from "./cli-updater";
import { compareSemanticVersions, extractSemanticVersion, normalizeCliVersionOutput, shouldRecommendVersionUpgrade } from "./cli-version";
import {
  EMPTY_PROVIDER_CAPABILITIES,
  getCliProviderCommand,
  getProviderUpgradeMissingCapabilityLabels,
  type ProviderRuntimeCapabilities,
} from "./provider-registry";
import type { CliProvider } from "./runtime-types";

export {
  getCliProviderCommand,
} from "./provider-registry";
export {
  extractSemanticVersion,
  normalizeCliVersionOutput,
} from "./cli-version";
export type { ProviderRuntimeCapabilities } from "./provider-registry";

export interface CliProviderRuntimeStatus {
  provider: CliProvider;
  command: string;
  installed: boolean;
  version: string | null;
  detail: string;
  checkedAt: number;
  resolvedPath: string | null;
  installMethod: CliInstallMethod | null;
  capabilities: ProviderRuntimeCapabilities;
  upgrade: CliUpgradePlan;
}

interface RunCommandResult {
  stdout: string;
  stderr: string;
  combinedOutput: string;
  success: boolean;
}

const CLI_COMMAND_TIMEOUT_MS = 3_000;
const CLI_COMMAND_MAX_BUFFER = 64 * 1024;

export async function probeCliProviderRuntime(provider: CliProvider): Promise<CliProviderRuntimeStatus> {
  const command = getCliProviderCommand(provider);
  const checkedAt = Date.now();

  try {
    const [versionResult, resolvedPath] = await Promise.all([
      runCommand(command, ["--version"]),
      resolveCommandPath(command),
    ]);
    const version = normalizeCliVersionOutput(versionResult.stdout, versionResult.stderr);
    const installMethod = detectCliInstallMethod(resolvedPath);
    const capabilities = await probeProviderCapabilities(provider, command);
    const latestVersion = await detectCliProviderLatestVersion(provider, installMethod);
    const upgrade = buildCliUpgradePlan({
      provider,
      version,
      latestVersion,
      installMethod,
      capabilities,
    });

    return {
      provider,
      command,
      installed: true,
      version,
      detail: version
        ? `Detected ${version}${upgrade.available ? ` · ${upgrade.reason}` : ""}`
        : "CLI is installed.",
      checkedAt,
      resolvedPath,
      installMethod,
      capabilities,
      upgrade,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const notInstalled = /\bENOENT\b/i.test(message) || /not recognized as an internal or external command/i.test(message);
    return {
      provider,
      command,
      installed: false,
      version: null,
      detail: notInstalled ? "CLI is not installed or not available in PATH." : message,
      checkedAt,
      resolvedPath: null,
      installMethod: null,
      capabilities: { ...EMPTY_PROVIDER_CAPABILITIES },
      upgrade: {
        available: false,
        required: false,
        installMethod: null,
        command: null,
        commandPreview: null,
        reason: null,
        latestVersion: null,
      },
    };
  }
}

export async function getCliProviderRuntimeStatuses(): Promise<Record<CliProvider, CliProviderRuntimeStatus>> {
  const [claude, codex] = await Promise.all([
    probeCliProviderRuntime("claude"),
    probeCliProviderRuntime("codex"),
  ]);

  return {
    claude,
    codex,
  };
}

export function buildCliUpgradePlan(options: {
  provider: CliProvider;
  version: string | null;
  latestVersion: string | null;
  installMethod: CliInstallMethod | null;
  capabilities: ProviderRuntimeCapabilities;
}): CliUpgradePlan {
  const reason = buildUpgradeReason(
    options.provider,
    options.version,
    options.latestVersion,
    options.capabilities,
  );
  const command = reason ? buildCliUpgradeCommand(options.provider, options.installMethod) : null;
  return {
    available: Boolean(reason && command),
    required: false,
    installMethod: options.installMethod,
    command,
    commandPreview: formatCliUpgradeCommandPreview(command),
    reason,
    latestVersion: options.latestVersion,
  };
}

async function probeProviderCapabilities(provider: CliProvider, command: string): Promise<ProviderRuntimeCapabilities> {
  if (provider === "codex") {
    const [execHelp, resumeHelp, reviewHelp, featuresHelp, mcpHelp] = await Promise.all([
      runCommand(command, ["exec", "--help"]).catch(() => createFailedCommandResult()),
      runCommand(command, ["exec", "resume", "--help"]).catch(() => createFailedCommandResult()),
      runCommand(command, ["review", "--help"]).catch(() => createFailedCommandResult()),
      runCommand(command, ["features", "--help"]).catch(() => createFailedCommandResult()),
      runCommand(command, ["mcp", "--help"]).catch(() => createFailedCommandResult()),
    ]);
    return {
      promptExecution: execHelp.success,
      resumeConversation: resumeHelp.success,
      webSearch: /--search\b/u.test(execHelp.combinedOutput),
      reviewCommand: reviewHelp.success,
      featuresCommand: featuresHelp.success,
      mcpCommand: mcpHelp.success,
      completionCommand: true,
      versionCommand: true,
      nativeTools: true,
    };
  }

  const help = await runCommand(command, ["--help"]).catch(() => createFailedCommandResult());
  return {
    promptExecution: help.success,
    resumeConversation: /(?:^|\s)-r(?:[\s,]|$)|resume/iu.test(help.combinedOutput),
    webSearch: false,
    reviewCommand: false,
    featuresCommand: false,
    mcpCommand: false,
    completionCommand: false,
    versionCommand: true,
    nativeTools: true,
  };
}

function buildUpgradeReason(
  provider: CliProvider,
  version: string | null,
  latestVersion: string | null,
  capabilities: ProviderRuntimeCapabilities,
): string | null {
  const reasons: string[] = [];
  const versionReason = buildVersionUpgradeReason(version, latestVersion);
  if (versionReason) {
    reasons.push(versionReason);
  }

  const missingCapabilities = getProviderUpgradeMissingCapabilityLabels(provider, capabilities);
  if (missingCapabilities.length > 0) {
    reasons.push(`Missing ${missingCapabilities.join(", ")} support.`);
  }

  if (reasons.length === 0) {
    return null;
  }
  return reasons.join(" ");
}

function buildVersionUpgradeReason(version: string | null, latestVersion: string | null): string | null {
  if (!shouldRecommendVersionUpgrade(version, latestVersion)) {
    return null;
  }

  const latestSemanticVersion = extractSemanticVersion(latestVersion) ?? latestVersion;
  const currentSemanticVersion = extractSemanticVersion(version);
  if (currentSemanticVersion && latestSemanticVersion) {
    const comparison = compareSemanticVersions(currentSemanticVersion, latestSemanticVersion);
    if (comparison !== null && comparison < 0) {
      return `Upgrade available: ${currentSemanticVersion} -> ${latestSemanticVersion}.`;
    }
  }

  if (latestSemanticVersion) {
    return `Upgrade available: latest version ${latestSemanticVersion} was detected.`;
  }

  return "Upgrade available: a newer CLI version was detected.";
}

function createFailedCommandResult(): RunCommandResult {
  return {
    stdout: "",
    stderr: "",
    combinedOutput: "",
    success: false,
  };
}

function resolveCommandPath(command: string): Promise<string | null> {
  const resolver = process.platform === "win32" ? "where.exe" : "which";
  return new Promise((resolve) => {
    execFile(
      resolver,
      [command],
      {
        timeout: CLI_COMMAND_TIMEOUT_MS,
        maxBuffer: CLI_COMMAND_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const firstLine = String(stdout ?? "")
          .replace(/\r\n/g, "\n")
          .split("\n")
          .map((line) => line.trim())
          .find(Boolean);
        resolve(firstLine || null);
      },
    );
  });
}

function runCommand(command: string, args: string[]): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: CLI_COMMAND_TIMEOUT_MS,
        maxBuffer: CLI_COMMAND_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const combinedOutput = [stdout, stderr]
          .map((part) => String(part ?? ""))
          .join("\n")
          .trim();
        if (error) {
          const failed = error as NodeJS.ErrnoException;
          if (combinedOutput.trim()) {
            resolve({
              stdout,
              stderr,
              combinedOutput,
              success: false,
            });
            return;
          }
          reject(failed);
          return;
        }
        resolve({
          stdout,
          stderr,
          combinedOutput,
          success: true,
        });
      },
    );
  });
}
