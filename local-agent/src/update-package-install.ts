import * as path from "path";

export interface LinuxDesktopPackageInstallPlan {
  command: string;
  args: string[];
  commandPreview: string;
}

export function isLinuxDesktopPackage(filePath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux") {
    return false;
  }
  const normalized = path.basename(filePath).toLowerCase();
  return normalized.endsWith(".deb")
    || normalized.endsWith(".pacman")
    || normalized.includes(".pkg.tar.");
}

export function isLinuxAppImage(filePath: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "linux" && path.basename(filePath).toLowerCase().endsWith(".appimage");
}

export function buildLinuxDesktopPackageInstallPlan(filePath: string): LinuxDesktopPackageInstallPlan | null {
  const normalized = path.basename(filePath).toLowerCase();
  if (normalized.endsWith(".deb")) {
    const args = ["apt", "install", "-y", filePath];
    return {
      command: "pkexec",
      args,
      commandPreview: formatCommandPreview("pkexec", args),
    };
  }
  if (normalized.endsWith(".pacman") || normalized.includes(".pkg.tar.")) {
    const args = ["pacman", "-U", "--noconfirm", filePath];
    return {
      command: "pkexec",
      args,
      commandPreview: formatCommandPreview("pkexec", args),
    };
  }
  return null;
}

export function buildLinuxDesktopPackageInstallCommand(filePath: string): string {
  const normalized = path.basename(filePath).toLowerCase();
  const quotedPath = quoteShellArg(filePath);
  if (normalized.endsWith(".deb")) {
    return `sudo apt install ${quotedPath}`;
  }
  if (normalized.endsWith(".pacman") || normalized.includes(".pkg.tar.")) {
    return `sudo pacman -U ${quotedPath}`;
  }
  return quotedPath;
}

function formatCommandPreview(command: string, args: string[]): string {
  return [command, ...args.map(quoteShellArg)].join(" ");
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
