import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SystemSoundCommand {
  command: string;
  args: string[];
}

export interface SystemSoundCommandOptions {
  bundledSoundPath?: string | null;
}

function toPowerShellSingleQuotedPath(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildWindowsNotificationSoundScript(bundledSoundPath?: string | null): string {
  const resolvedSoundPath = bundledSoundPath?.trim()
    ? toPowerShellSingleQuotedPath(bundledSoundPath.trim())
    : "Join-Path $env:WINDIR 'Media\\Windows Notify System Generic.wav'";
  return [
    `$soundPath = ${resolvedSoundPath}`,
    "try {",
    "  if (Test-Path $soundPath) {",
    "    $player = New-Object System.Media.SoundPlayer $soundPath",
    "    $player.PlaySync()",
    "  } else {",
    "    [Console]::Beep(880, 220)",
    "  }",
    "} catch {",
    "  try {",
    "    [Console]::Beep(880, 220)",
    "  } catch {",
    "    [System.Media.SystemSounds]::Asterisk.Play()",
    "    Start-Sleep -Milliseconds 250",
    "  }",
    "}",
  ].join("\n");
}

export function getSystemSoundCommand(
  platform: NodeJS.Platform = process.platform,
  options: SystemSoundCommandOptions = {},
): SystemSoundCommand | null {
  switch (platform) {
    case "win32":
      return {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          buildWindowsNotificationSoundScript(options.bundledSoundPath),
        ],
      };
    case "darwin":
      return {
        command: "afplay",
        args: ["/System/Library/Sounds/Glass.aiff"],
      };
    case "linux":
      return {
        command: "canberra-gtk-play",
        args: ["-i", "complete", "-d", "AgentFlow"],
      };
    default:
      return null;
  }
}

export async function playSystemNotificationSound(
  platform: NodeJS.Platform = process.platform,
  options: SystemSoundCommandOptions = {},
): Promise<boolean> {
  const command = getSystemSoundCommand(platform, options);
  if (!command) {
    return false;
  }

  try {
    await execFileAsync(command.command, command.args, {
      windowsHide: true,
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}
