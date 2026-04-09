import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SystemSoundCommand {
  command: string;
  args: string[];
}

export function getSystemSoundCommand(platform: NodeJS.Platform = process.platform): SystemSoundCommand | null {
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
          "[System.Media.SystemSounds]::Asterisk.Play()",
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

export async function playSystemNotificationSound(platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const command = getSystemSoundCommand(platform);
  if (!command) {
    return false;
  }

  try {
    await execFileAsync(command.command, command.args, {
      windowsHide: true,
      timeout: 4000,
    });
    return true;
  } catch {
    return false;
  }
}
