import type { CliProviderRuntimeStatus } from "./cli-runtime-status";
import type { ProviderSdkPackageStatus } from "./provider-sdk-manager";

export function shouldPrepareManagedProviderSdkRuntime(options: {
  cliStatus: CliProviderRuntimeStatus | null | undefined;
  sdkConfigured: boolean;
}): boolean {
  const cliStatus = options.cliStatus ?? null;
  if (!cliStatus?.installed) {
    return true;
  }

  return options.sdkConfigured && cliStatus.capabilities.promptExecution !== true;
}

export function shouldMaintainManagedProviderSdkPackage(options: {
  sdkStatus: ProviderSdkPackageStatus;
}): boolean {
  return !options.sdkStatus.installed || options.sdkStatus.upgradeAvailable;
}

export function shouldAutoMaintainManagedProviderSdk(options: {
  cliStatus: CliProviderRuntimeStatus | null | undefined;
  sdkStatus: ProviderSdkPackageStatus;
  sdkConfigured: boolean;
}): boolean {
  if (!shouldPrepareManagedProviderSdkRuntime({
    cliStatus: options.cliStatus,
    sdkConfigured: options.sdkConfigured,
  })) {
    return false;
  }

  return !options.sdkStatus.installed || options.sdkStatus.upgradeAvailable;
}
