import { execFile } from "child_process";
import { buildNpmCommandEnvironment } from "./npm-network";

const NPM_COMMAND_TIMEOUT_MS = 8_000;
const NPM_COMMAND_MAX_BUFFER = 128 * 1024;

export function getNpmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

export async function isNpmCommandAvailable(
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  try {
    await runNpmCommand(platform, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function runNpmCommand(
  platform: NodeJS.Platform,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      getNpmCommand(platform),
      args,
      {
        timeout: NPM_COMMAND_TIMEOUT_MS,
        maxBuffer: NPM_COMMAND_MAX_BUFFER,
        windowsHide: true,
        env: buildNpmCommandEnvironment(),
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
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
