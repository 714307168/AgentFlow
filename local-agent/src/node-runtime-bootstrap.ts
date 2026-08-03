import { execFile } from "child_process";
import * as fs from "fs";
import path from "path";
import { promisify } from "util";
import { isNpmCommandAvailable } from "./npm-package-manager";

const execFileAsync = promisify(execFile);
const NODE_BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000;

export interface NodeRuntimeBootstrapPlan {
  command: string;
  args: string[];
}

export interface NodeRuntimeBootstrapResult {
  success: boolean;
  available: boolean;
  installed: boolean;
  commandPreview: string | null;
  error?: string;
}

export function buildNodeRuntimeBootstrapPlan(
  platform: NodeJS.Platform = process.platform,
): NodeRuntimeBootstrapPlan | null {
  if (platform === "win32") {
    return {
      command: "winget",
      args: [
        "install",
        "--id", "OpenJS.NodeJS.LTS",
        "--exact",
        "--silent",
        "--accept-source-agreements",
        "--accept-package-agreements",
      ],
    };
  }
  if (platform === "darwin") {
    return { command: "brew", args: ["install", "node"] };
  }
  return null;
}

export function formatNodeRuntimeBootstrapPlan(plan: NodeRuntimeBootstrapPlan | null): string | null {
  return plan ? [plan.command, ...plan.args].join(" ") : null;
}

function exposeWindowsNodePath(env: NodeJS.ProcessEnv = process.env): void {
  const programFiles = String(env.ProgramFiles ?? "C:\\Program Files").trim();
  const nodeDirectory = path.join(programFiles, "nodejs");
  if (!fs.existsSync(path.join(nodeDirectory, "npm.cmd"))) {
    return;
  }
  const delimiter = path.delimiter;
  const currentPath = String(env.Path ?? env.PATH ?? "");
  const entries = currentPath.split(delimiter).filter(Boolean);
  if (!entries.some((entry) => entry.toLowerCase() === nodeDirectory.toLowerCase())) {
    env.PATH = [nodeDirectory, ...entries].join(delimiter);
  }
}

export async function ensureNpmRuntime(
  platform: NodeJS.Platform = process.platform,
): Promise<NodeRuntimeBootstrapResult> {
  if (await isNpmCommandAvailable(platform)) {
    return { success: true, available: true, installed: false, commandPreview: null };
  }

  const plan = buildNodeRuntimeBootstrapPlan(platform);
  const commandPreview = formatNodeRuntimeBootstrapPlan(plan);
  if (!plan) {
    return {
      success: false,
      available: false,
      installed: false,
      commandPreview,
      error: "Automatic Node.js bootstrap is currently supported on Windows and macOS only.",
    };
  }

  try {
    await execFileAsync(plan.command, plan.args, {
      timeout: NODE_BOOTSTRAP_TIMEOUT_MS,
      windowsHide: true,
    });
    if (platform === "win32") {
      exposeWindowsNodePath();
    }
    const available = await isNpmCommandAvailable(platform);
    return available
      ? { success: true, available: true, installed: true, commandPreview }
      : {
        success: false,
        available: false,
        installed: true,
        commandPreview,
        error: "Node.js installed, but npm is not available to the current app session yet. Restart AgentFlow and try again.",
      };
  } catch (error) {
    return {
      success: false,
      available: false,
      installed: false,
      commandPreview,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
