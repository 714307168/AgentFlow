import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { probeCliProviderRuntime } from "./cli-runtime-status";
import { buildDesktopStartupModePlan } from "./desktop-startup-mode";
import { getPersistedLocalDataRootForEnvironment } from "./local-data-path";
import { resolvePreferredNpmRegistry } from "./npm-network";
import { hasProviderApiFallback, type ProviderConfigSnapshot } from "./provider-registry";
import { selectProviderRuntime } from "./provider-runtime";
import type { CliProvider } from "./runtime-types";

interface DoctorConfigShape extends ProviderConfigSnapshot {
  cliProvider?: CliProvider | string | null;
  encryptedOpenaiApiKey?: string | null;
  encryptedAnthropicApiKey?: string | null;
  projects?: unknown[];
}

interface ProviderDoctorRecord {
  provider: CliProvider;
  cliInstalled: boolean;
  cliVersion: string | null;
  runtimeKind: "cli" | "sdk" | "unavailable";
  runtimeDetail: string;
  sdkConfigured: boolean;
  autoInstallReady: boolean;
  autoUpgradeReady: boolean;
}

interface DoctorReport {
  generatedAt: string;
  hostname: string;
  platform: NodeJS.Platform;
  release: string;
  npmRegistry: string;
  npmAvailable: boolean;
  npmPath: string | null;
  localDataRoot: string;
  configPath: string;
  configExists: boolean;
  projectCount: number;
  preferredProvider: string | null;
  safeGraphicsEnabled: boolean;
  safeGraphicsReasons: string[];
  providers: ProviderDoctorRecord[];
  issues: string[];
}

const PROVIDERS: CliProvider[] = ["claude", "codex"];
const CONFIG_FILE_NAME = "config.json";
const COMMAND_TIMEOUT_MS = 4_000;
const COMMAND_MAX_BUFFER = 64 * 1024;

function readConfigFile(configPath: string): DoctorConfigShape | null {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as DoctorConfigShape;
  } catch (_error) {
    return null;
  }
}

function hasSdkConfig(config: DoctorConfigShape | null, provider: CliProvider): boolean {
  if (!config) {
    return false;
  }
  if (hasProviderApiFallback(config, provider)) {
    return true;
  }
  if (provider === "codex") {
    return Boolean(String(config.encryptedOpenaiApiKey ?? "").trim());
  }
  return Boolean(String(config.encryptedAnthropicApiKey ?? "").trim());
}

function resolveCommandPath(command: string): Promise<string | null> {
  const resolver = process.platform === "win32" ? "where.exe" : "which";
  return new Promise((resolve) => {
    execFile(
      resolver,
      [command],
      {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: COMMAND_MAX_BUFFER,
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

async function buildDoctorReport(): Promise<DoctorReport> {
  const localDataRoot = getPersistedLocalDataRootForEnvironment();
  const configPath = path.join(localDataRoot, CONFIG_FILE_NAME);
  const config = readConfigFile(configPath);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const [npmPath, ...providerStatuses] = await Promise.all([
    resolveCommandPath(npmCommand),
    ...PROVIDERS.map((provider) => probeCliProviderRuntime(provider)),
  ]);
  const safeModePlan = buildDesktopStartupModePlan({
    platform: process.platform,
    osRelease: os.release(),
    argv: process.argv,
    env: process.env,
  });
  const npmAvailable = Boolean(npmPath);
  const providers = providerStatuses.map((status) => {
    const sdkConfigured = hasSdkConfig(config, status.provider);
    const runtime = selectProviderRuntime({
      provider: status.provider,
      cliStatus: status,
      sdkConfigured,
    });
    return {
      provider: status.provider,
      cliInstalled: status.installed,
      cliVersion: status.version,
      runtimeKind: runtime.kind,
      runtimeDetail: runtime.detail,
      sdkConfigured,
      autoInstallReady: !status.installed && npmAvailable,
      autoUpgradeReady: status.installed && status.upgrade.available,
    } satisfies ProviderDoctorRecord;
  });

  const issues: string[] = [];
  if (!config) {
    issues.push("Desktop config.json was not found under the local data root.");
  }
  if (!npmAvailable) {
    issues.push("npm is not available in PATH, so automatic provider runtime bootstrap cannot run.");
  }
  if (!providers.some((provider) => provider.runtimeKind === "cli" || provider.runtimeKind === "sdk" || provider.autoInstallReady)) {
    issues.push("No provider is currently runnable and no automatic provider bootstrap path is available.");
  }

  return {
    generatedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    npmRegistry: resolvePreferredNpmRegistry(),
    npmAvailable,
    npmPath,
    localDataRoot,
    configPath,
    configExists: Boolean(config),
    projectCount: Array.isArray(config?.projects) ? config.projects.length : 0,
    preferredProvider: typeof config?.cliProvider === "string" ? config.cliProvider : null,
    safeGraphicsEnabled: safeModePlan.safeGraphics,
    safeGraphicsReasons: safeModePlan.reasons,
    providers,
    issues,
  };
}

function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [
    "AgentFlow Desktop Doctor",
    "Generated: " + report.generatedAt,
    "",
    "Environment",
    "- Host: " + report.hostname,
    "- Platform: " + report.platform + " " + report.release,
    "- npm registry: " + report.npmRegistry,
    "- npm available: " + (report.npmAvailable ? "yes" : "no") + (report.npmPath ? " (" + report.npmPath + ")" : ""),
    "- local data root: " + report.localDataRoot,
    "- config.json: " + (report.configExists ? "found" : "missing") + " (" + report.configPath + ")",
    "- configured projects: " + report.projectCount,
    "- preferred provider: " + (report.preferredProvider ?? "unset"),
    "",
    "Startup",
    "- safe graphics mode: " + (report.safeGraphicsEnabled ? "enabled" : "disabled"),
    "- safe graphics reasons: " + (report.safeGraphicsReasons.length > 0 ? report.safeGraphicsReasons.join(", ") : "none"),
    "",
    "Providers",
  ];

  for (const provider of report.providers) {
    lines.push("- " + provider.provider);
    lines.push("  runtime: " + provider.runtimeKind);
    lines.push("  detail: " + provider.runtimeDetail);
    lines.push("  cli installed: " + (provider.cliInstalled ? "yes" : "no") + (provider.cliVersion ? " (" + provider.cliVersion + ")" : ""));
    lines.push("  sdk configured: " + (provider.sdkConfigured ? "yes" : "no"));
    lines.push("  auto install ready: " + (provider.autoInstallReady ? "yes" : "no"));
    lines.push("  auto upgrade ready: " + (provider.autoUpgradeReady ? "yes" : "no"));
  }

  lines.push("");
  lines.push("Summary");
  if (report.issues.length === 0) {
    lines.push("- status: healthy");
  } else {
    lines.push("- status: action required");
    for (const issue of report.issues) {
      lines.push("- issue: " + issue);
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  const report = await buildDoctorReport();
  const jsonOutput = process.argv.includes("--json");
  process.stdout.write(jsonOutput
    ? JSON.stringify(report, null, 2) + "\n"
    : formatDoctorReport(report) + "\n");
  if (report.issues.length > 0) {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  process.stderr.write("AgentFlow Desktop Doctor failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
