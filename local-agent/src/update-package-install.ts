import * as path from "path";

export function isLinuxDesktopPackage(filePath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux") {
    return false;
  }
  const normalized = path.basename(filePath).toLowerCase();
  return normalized.endsWith(".deb")
    || normalized.endsWith(".pacman")
    || normalized.includes(".pkg.tar.");
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

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
