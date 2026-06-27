import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { parseNpmLatestVersion } from "./cli-latest-version";
import { buildNpmCommandEnvironment, resolvePreferredNpmRegistry } from "./npm-network";
import { getNpmCommand, isNpmCommandAvailable } from "./npm-package-manager";
import { getPersistedLocalDataRoot } from "./user-data-bootstrap";
import { compareSemanticVersions, extractSemanticVersion, shouldRecommendVersionUpgrade } from "./cli-version";
import type { CliProvider } from "./runtime-types";

export interface ProviderSdkPackageStatus {
  provider: CliProvider;
  packageName: string;
  installed: boolean;
  version: string | null;
  latestVersion: string | null;
  upgradeAvailable: boolean;
  installRoot: string;
  packageJsonPath: string;
  resolvedModulePath: string | null;
  detail: string;
  checkedAt: number;
}

export interface ProviderSdkInstallCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface ProviderSdkMaintainResult {
  success: boolean;
  output: string;
  commandPreview: string;
  error?: string;
  skipped?: boolean;
  fallbackAvailable?: boolean;
}

const PROVIDER_SDK_DIRECTORY = "provider-sdk-runtime";
const PROVIDER_SDK_TIMEOUT_MS = 10 * 60 * 1000;
const PROVIDER_SDK_MAX_BUFFER = 256 * 1024;
const PROVIDER_SDK_VERSION_QUERY_TIMEOUT_MS = 8_000;
const PROVIDER_SDK_VERSION_QUERY_MAX_BUFFER = 128 * 1024;

export function getProviderSdkPackageManagerCommand(
  platform: NodeJS.Platform = process.platform,
): string {
  return getNpmCommand(platform);
}

export function getProviderSdkPackageName(provider: CliProvider): string {
  return provider === "codex" ? "openai" : "@anthropic-ai/sdk";
}

export function resolveManagedProviderSdkInstallRoot(
  provider: CliProvider,
  localDataRoot = getPersistedLocalDataRoot(),
): string {
  return path.join(localDataRoot, PROVIDER_SDK_DIRECTORY, provider);
}

export function ensureManagedProviderSdkProject(provider: CliProvider, installRoot: string): string {
  fs.mkdirSync(installRoot, { recursive: true });
  const packageJsonPath = path.join(installRoot, "package.json");
  const payload = {
    name: `agentflow-provider-sdk-${provider}`,
    private: true,
    description: `Managed SDK runtime for ${provider}`,
  };
  fs.writeFileSync(packageJsonPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return packageJsonPath;
}

export function buildProviderSdkInstallCommand(
  provider: CliProvider,
  installRoot = resolveManagedProviderSdkInstallRoot(provider),
  platform: NodeJS.Platform = process.platform,
): ProviderSdkInstallCommand {
  ensureManagedProviderSdkProject(provider, installRoot);
  return {
    command: getProviderSdkPackageManagerCommand(platform),
    args: [
      "install",
      "--no-save",
      "--prefix",
      installRoot,
      `${getProviderSdkPackageName(provider)}@latest`,
      "--registry",
      resolvePreferredNpmRegistry(),
    ],
    env: buildNpmCommandEnvironment(),
  };
}

export function formatProviderSdkInstallCommand(command: ProviderSdkInstallCommand): string {
  return [command.command, ...command.args]
    .map((part) => (/\s/u.test(part) ? `"${part.replace(/"/g, '\\\"')}"` : part))
    .join(" ");
}

export async function detectProviderSdkLatestVersion(
  provider: CliProvider,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  try {
    const result = await runCommand(
      getProviderSdkPackageManagerCommand(platform),
      ["view", getProviderSdkPackageName(provider), "version", "--json", "--registry", resolvePreferredNpmRegistry()],
      buildNpmCommandEnvironment(),
      PROVIDER_SDK_VERSION_QUERY_TIMEOUT_MS,
      PROVIDER_SDK_VERSION_QUERY_MAX_BUFFER,
    );
    return parseNpmLatestVersion(result.stdout, result.stderr);
  } catch {
    return null;
  }
}

export async function isProviderSdkPackageManagerAvailable(
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  return await isNpmCommandAvailable(platform);
}

export function readInstalledProviderSdkVersion(
  provider: CliProvider,
  installRoot = resolveManagedProviderSdkInstallRoot(provider),
): { version: string | null; packageJsonPath: string; resolvedModulePath: string | null } {
  const modulePackageJsonPath = path.join(installRoot, "node_modules", getProviderSdkPackageName(provider), "package.json");
  try {
    const payload = JSON.parse(fs.readFileSync(modulePackageJsonPath, "utf8")) as { version?: string };
    const version = typeof payload.version === "string" && payload.version.trim() ? payload.version.trim() : null;
    return {
      version,
      packageJsonPath: modulePackageJsonPath,
      resolvedModulePath: path.dirname(modulePackageJsonPath),
    };
  } catch {
    return {
      version: null,
      packageJsonPath: modulePackageJsonPath,
      resolvedModulePath: null,
    };
  }
}

export async function probeManagedProviderSdk(
  provider: CliProvider,
  installRoot = resolveManagedProviderSdkInstallRoot(provider),
): Promise<ProviderSdkPackageStatus> {
  const checkedAt = Date.now();
  const packageName = getProviderSdkPackageName(provider);
  const installed = readInstalledProviderSdkVersion(provider, installRoot);
  const latestVersion = await detectProviderSdkLatestVersion(provider);
  const upgradeAvailable = shouldRecommendVersionUpgrade(installed.version, latestVersion);
  return {
    provider,
    packageName,
    installed: Boolean(installed.version),
    version: installed.version,
    latestVersion,
    upgradeAvailable,
    installRoot,
    packageJsonPath: installed.packageJsonPath,
    resolvedModulePath: installed.resolvedModulePath,
    detail: buildProviderSdkStatusDetail(installed.version, latestVersion, upgradeAvailable),
    checkedAt,
  };
}

export async function maintainManagedProviderSdk(
  provider: CliProvider,
  installRoot = resolveManagedProviderSdkInstallRoot(provider),
  options: { sdkConfigured?: boolean; packageManagerAvailable?: boolean } = {},
): Promise<ProviderSdkMaintainResult> {
  const command = buildProviderSdkInstallCommand(provider, installRoot);
  const commandPreview = formatProviderSdkInstallCommand(command);
  const packageManagerAvailable = options.packageManagerAvailable
    ?? await isProviderSdkPackageManagerAvailable();
  if (!packageManagerAvailable) {
    const fallbackAvailable = options.sdkConfigured === true;
    return {
      success: fallbackAvailable,
      skipped: true,
      fallbackAvailable,
      output: fallbackAvailable
        ? "npm is not available. Managed SDK installation was skipped; the built-in HTTP API runtime will be used."
        : "npm is not available. Managed SDK installation was skipped, and no API credentials are configured.",
      commandPreview,
      error: fallbackAvailable ? undefined : "npm is not available in PATH.",
    };
  }
  try {
    const result = await runCommand(
      command.command,
      command.args,
      command.env,
      PROVIDER_SDK_TIMEOUT_MS,
      PROVIDER_SDK_MAX_BUFFER,
    );
    return {
      success: true,
      output: [result.stdout, result.stderr].map((part) => String(part ?? "").trim()).filter(Boolean).join("\n").trim(),
      commandPreview,
    };
  } catch (error) {
    const failed = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const output = [failed?.stdout, failed?.stderr]
      .map((part) => String(part ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    return {
      success: false,
      output,
      commandPreview,
      error: failed?.message || String(error),
    };
  }
}

export function loadManagedProviderSdkModule(
  provider: CliProvider,
  installRoot = resolveManagedProviderSdkInstallRoot(provider),
): unknown | null {
  const modulePath = path.join(installRoot, "package.json");
  if (!fs.existsSync(modulePath)) {
    return null;
  }
  try {
    const runtimeRequire = createRequire(modulePath);
    return runtimeRequire(getProviderSdkPackageName(provider));
  } catch {
    return null;
  }
}

function buildProviderSdkStatusDetail(
  installedVersion: string | null,
  latestVersion: string | null,
  upgradeAvailable: boolean,
): string {
  if (!installedVersion) {
    return "Managed SDK is not installed yet.";
  }
  if (!upgradeAvailable) {
    return `Managed SDK ${installedVersion} is ready.`;
  }
  const currentSemanticVersion = extractSemanticVersion(installedVersion);
  const latestSemanticVersion = extractSemanticVersion(latestVersion);
  if (currentSemanticVersion && latestSemanticVersion) {
    const comparison = compareSemanticVersions(currentSemanticVersion, latestSemanticVersion);
    if (comparison !== null && comparison < 0) {
      return `Managed SDK can be upgraded: ${currentSemanticVersion} -> ${latestSemanticVersion}.`;
    }
  }
  return `Managed SDK ${installedVersion} has a newer version available.`;
}

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
  timeout: number,
  maxBuffer: number,
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout,
        maxBuffer,
        windowsHide: true,
        env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const wrapped = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
          wrapped.stdout = String(stdout ?? "");
          wrapped.stderr = String(stderr ?? "");
          reject(wrapped);
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
