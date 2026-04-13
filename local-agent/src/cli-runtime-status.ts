import { execFile } from "child_process";
import { buildCliUpgradeCommand, detectCliInstallMethod, formatCliUpgradeCommandPreview, type CliInstallMethod, type CliUpgradePlan } from "./cli-updater";
import type { CliProvider } from "./runtime-types";

export interface ProviderRuntimeCapabilities {
  promptExecution: boolean;
  resumeConversation: boolean;
  webSearch: boolean;
  reviewCommand: boolean;
  featuresCommand: boolean;
  mcpCommand: boolean;
  completionCommand: boolean;
  versionCommand: boolean;
  nativeTools: boolean;
}

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

const EMPTY_CAPABILITIES: ProviderRuntimeCapabilities = {
  promptExecution: false,
  resumeConversation: false,
  webSearch: false,
  reviewCommand: false,
  featuresCommand: false,
  mcpCommand: false,
  completionCommand: false,
  versionCommand: false,
  nativeTools: false,
};

export function getCliProviderCommand(
  provider: CliProvider,
  platform: NodeJS.Platform = process.platform,
): string {
  const base = provider === "codex" ? "codex" : "claude";
  return platform === "win32" ? `${base}.cmd` : base;
}

export function normalizeCliVersionOutput(stdout: string, stderr = ""): string | null {
  const merged = `${stdout}\n${stderr}`
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => Boolean(line));
  return merged || null;
}

export function extractSemanticVersion(rawVersion: string | null | undefined): string | null {
  const match = String(rawVersion ?? "").match(/(\d+\.\d+\.\d+)/u);
  return match ? match[1] : null;
}

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
    const upgrade = buildCliUpgradePlan({
      provider,
      version,
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
      capabilities: { ...EMPTY_CAPABILITIES },
      upgrade: {
        available: false,
        required: false,
        installMethod: null,
        command: null,
        commandPreview: null,
        reason: null,
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
  installMethod: CliInstallMethod | null;
  capabilities: ProviderRuntimeCapabilities;
}): CliUpgradePlan {
  const reason = buildUpgradeReason(options.provider, options.capabilities);
  const command = reason ? buildCliUpgradeCommand(options.provider, options.installMethod) : null;
  return {
    available: Boolean(reason && command),
    required: false,
    installMethod: options.installMethod,
    command,
    commandPreview: formatCliUpgradeCommandPreview(command),
    reason,
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

function buildUpgradeReason(provider: CliProvider, capabilities: ProviderRuntimeCapabilities): string | null {
  const missingCapabilities: string[] = [];
  if (!capabilities.promptExecution) {
    missingCapabilities.push("prompt execution");
  }
  if (provider === "codex") {
    if (!capabilities.resumeConversation) {
      missingCapabilities.push("conversation resume");
    }
    if (!capabilities.webSearch) {
      missingCapabilities.push("web search flag");
    }
  }
  if (missingCapabilities.length === 0) {
    return null;
  }
  return `Upgrade recommended: missing ${missingCapabilities.join(", ")} support.`;
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
