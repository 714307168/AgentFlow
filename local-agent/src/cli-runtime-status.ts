import { execFile } from "child_process";
import type { CliProvider } from "./runtime-types";

export interface CliProviderRuntimeStatus {
  provider: CliProvider;
  command: string;
  installed: boolean;
  version: string | null;
  detail: string;
  checkedAt: number;
}

const CLI_VERSION_TIMEOUT_MS = 3_000;
const CLI_VERSION_MAX_BUFFER = 64 * 1024;

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

export async function probeCliProviderRuntime(provider: CliProvider): Promise<CliProviderRuntimeStatus> {
  const command = getCliProviderCommand(provider);
  const checkedAt = Date.now();

  try {
    const version = await runVersionCommand(command);
    return {
      provider,
      command,
      installed: true,
      version,
      detail: version ? `Detected ${version}` : "CLI is installed.",
      checkedAt,
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

function runVersionCommand(command: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      ["--version"],
      {
        timeout: CLI_VERSION_TIMEOUT_MS,
        maxBuffer: CLI_VERSION_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(normalizeCliVersionOutput(stdout, stderr));
      },
    );
  });
}
