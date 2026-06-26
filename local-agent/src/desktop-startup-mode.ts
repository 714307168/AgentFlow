export interface DesktopStartupModeOptions {
  platform?: NodeJS.Platform;
  osRelease?: string | null;
  argv?: string[] | null;
  env?: Record<string, string | undefined> | null;
}

export interface DesktopStartupSwitch {
  name: string;
  value?: string;
}

export interface DesktopStartupModePlan {
  safeGraphics: boolean;
  disableHardwareAcceleration: boolean;
  switches: DesktopStartupSwitch[];
  reasons: string[];
}

interface AppCommandLineLike {
  appendSwitch(name: string, value?: string): void;
}

interface AppLike {
  disableHardwareAcceleration(): void;
  commandLine: AppCommandLineLike;
}

const SAFE_GRAPHICS_SWITCHES: DesktopStartupSwitch[] = [
  { name: "disable-gpu" },
  { name: "disable-gpu-compositing" },
  { name: "disable-accelerated-2d-canvas" },
  { name: "disable-accelerated-video-decode" },
  { name: "disable-gpu-memory-buffer-video-frames" },
  { name: "disable-zero-copy" },
];

const SAFE_GRAPHICS_DISABLED_FEATURES = [
  "CalculateNativeWinOcclusion",
];

const LINUX_COMPATIBILITY_SWITCHES: DesktopStartupSwitch[] = [
  { name: "no-sandbox" },
  { name: "disable-dev-shm-usage" },
  { name: "ozone-platform", value: "x11" },
];

const LINUX_COMPATIBILITY_DISABLED_FEATURES = [
  "WaylandWindowDecorations",
];

function normalizeBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isManualSafeModeRequested(
  argv: string[] | null | undefined,
  env: Record<string, string | undefined> | null | undefined,
): boolean {
  if (Array.isArray(argv)) {
    for (const entry of argv) {
      const normalized = String(entry || "").trim().toLowerCase();
      if (
        normalized === "--safe-mode"
        || normalized === "--disable-gpu"
        || normalized === "--software-rendering"
      ) {
        return true;
      }
    }
  }
  return normalizeBooleanFlag(env?.AGENTFLOW_SAFE_MODE);
}

function parseWindowsBuildNumber(osRelease: string | null | undefined): number | null {
  if (!osRelease) {
    return null;
  }
  const parts = String(osRelease).trim().split(".");
  if (parts.length < 3) {
    return null;
  }
  const build = Number.parseInt(parts[2] || "", 10);
  return Number.isFinite(build) ? build : null;
}

function shouldEnableLegacyWindowsSafeMode(
  platform: NodeJS.Platform,
  osRelease: string | null | undefined,
): boolean {
  if (platform !== "win32") {
    return false;
  }
  const build = parseWindowsBuildNumber(osRelease);
  return build !== null && build <= 14393;
}

function shouldEnableLinuxCompatibilityMode(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> | null | undefined,
): boolean {
  if (platform !== "linux") {
    return false;
  }
  return !normalizeBooleanFlag(env?.AGENTFLOW_DISABLE_LINUX_COMPATIBILITY_MODE);
}

function buildStartupSwitches(enableSafeGraphics: boolean, enableLinuxCompatibilityMode: boolean): DesktopStartupSwitch[] {
  const disabledFeatures = [
    ...(enableSafeGraphics ? SAFE_GRAPHICS_DISABLED_FEATURES : []),
    ...(enableLinuxCompatibilityMode ? LINUX_COMPATIBILITY_DISABLED_FEATURES : []),
  ];

  return [
    ...(enableSafeGraphics ? SAFE_GRAPHICS_SWITCHES : []),
    ...(disabledFeatures.length > 0 ? [{ name: "disable-features", value: disabledFeatures.join(",") }] : []),
    ...(enableLinuxCompatibilityMode ? LINUX_COMPATIBILITY_SWITCHES : []),
  ].map((entry) => ({ ...entry }));
}

export function buildDesktopStartupModePlan(options: DesktopStartupModeOptions = {}): DesktopStartupModePlan {
  const platform = options.platform ?? process.platform;
  const osRelease = options.osRelease ?? null;
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;
  const reasons: string[] = [];

  if (isManualSafeModeRequested(argv, env)) {
    reasons.push("manual-safe-mode");
  }
  if (shouldEnableLegacyWindowsSafeMode(platform, osRelease)) {
    reasons.push("legacy-windows-build");
  }
  if (shouldEnableLinuxCompatibilityMode(platform, env)) {
    reasons.push("linux-compatibility-mode");
  }

  if (reasons.length === 0) {
    return {
      safeGraphics: false,
      disableHardwareAcceleration: false,
      switches: [],
      reasons: [],
    };
  }
  const enableSafeGraphics = reasons.includes("manual-safe-mode") || reasons.includes("legacy-windows-build");

  return {
    safeGraphics: true,
    disableHardwareAcceleration: enableSafeGraphics,
    switches: buildStartupSwitches(enableSafeGraphics, reasons.includes("linux-compatibility-mode")),
    reasons,
  };
}

export function applyDesktopStartupModePlan(appLike: AppLike, plan: DesktopStartupModePlan): void {
  if (!plan.safeGraphics) {
    return;
  }
  if (plan.disableHardwareAcceleration) {
    appLike.disableHardwareAcceleration();
  }
  for (const entry of plan.switches) {
    appLike.commandLine.appendSwitch(entry.name, entry.value);
  }
}
