import type { CliProvider } from "./runtime-types";
import type { CliProviderRuntimeStatus, ProviderRuntimeCapabilities } from "./cli-runtime-status";

export type ProviderRuntimeKind = "cli" | "sdk" | "unavailable";

export interface ProviderRuntimeSelection {
  provider: CliProvider;
  kind: ProviderRuntimeKind;
  detail: string;
  sdkConfigured: boolean;
  cliStatus: CliProviderRuntimeStatus | null;
  capabilities: ProviderRuntimeCapabilities;
}

export function selectProviderRuntime(options: {
  provider: CliProvider;
  cliStatus: CliProviderRuntimeStatus | null | undefined;
  sdkConfigured: boolean;
}): ProviderRuntimeSelection {
  const cliStatus = options.cliStatus ?? null;
  const capabilities = cliStatus?.capabilities ?? createUnavailableCapabilities();
  const cliCanExecutePrompts = cliStatus?.installed === true && capabilities.promptExecution;

  if (cliCanExecutePrompts) {
    return {
      provider: options.provider,
      kind: "cli",
      detail: cliStatus.upgrade.available
        ? cliStatus.upgrade.reason ?? "CLI is available and can be upgraded."
        : "CLI is available.",
      sdkConfigured: options.sdkConfigured,
      cliStatus,
      capabilities,
    };
  }

  if (options.sdkConfigured) {
    return {
      provider: options.provider,
      kind: "sdk",
      detail: cliStatus?.installed
        ? "The local CLI is installed but does not support prompt execution, so the desktop will fall back to the configured API runtime."
        : "CLI is unavailable, so the desktop will fall back to the configured API runtime.",
      sdkConfigured: true,
      cliStatus,
      capabilities: {
        promptExecution: true,
        resumeConversation: false,
        webSearch: false,
        reviewCommand: false,
        featuresCommand: false,
        mcpCommand: false,
        completionCommand: false,
        versionCommand: false,
        nativeTools: false,
      },
    };
  }

  return {
    provider: options.provider,
    kind: "unavailable",
    detail: cliStatus?.installed
      ? "A local CLI was detected, but it does not support prompt execution and no API fallback is configured for this provider."
      : "Neither a local CLI runtime nor API credentials are available for this provider.",
    sdkConfigured: false,
    cliStatus,
    capabilities,
  };
}

function createUnavailableCapabilities(): ProviderRuntimeCapabilities {
  return {
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
}
