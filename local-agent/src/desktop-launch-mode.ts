export interface DesktopLaunchModeOptions {
  silentLaunch?: boolean;
  argv?: string[] | null;
}

export function hasHiddenLaunchArg(argv: string[] | null | undefined): boolean {
  if (!Array.isArray(argv)) {
    return false;
  }
  return argv.some((entry) => {
    const normalized = String(entry || "").trim().toLowerCase();
    return normalized === "--hidden" || normalized === "--background" || normalized === "--minimized";
  });
}

export function hasUpdatedLaunchArg(argv: string[] | null | undefined): boolean {
  if (!Array.isArray(argv)) {
    return false;
  }
  return argv.some((entry) => String(entry || "").trim().toLowerCase() === "--updated");
}

export function shouldShowWorkspaceOnStartup(options: DesktopLaunchModeOptions = {}): boolean {
  const argv = options.argv ?? process.argv;
  if (hasUpdatedLaunchArg(argv)) {
    return true;
  }
  if (!options.silentLaunch) {
    return true;
  }
  return !hasHiddenLaunchArg(argv);
}

export function buildLoginItemArgs(silentLaunch: boolean): string[] {
  return silentLaunch ? ["--hidden"] : [];
}
