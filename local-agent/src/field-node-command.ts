import { execFile } from "child_process";

export type FieldNodeCommandAction = "ping" | "runtime-status" | "disk-status";
export interface FieldNodeCommandResult { action: FieldNodeCommandAction; ok: boolean; output: string; executedAt: number; }

const MAX_OUTPUT = 16 * 1024;
const TIMEOUT_MS = 12_000;

export function isFieldNodeCommandAction(value: unknown): value is FieldNodeCommandAction {
  return value === "ping" || value === "runtime-status" || value === "disk-status";
}

export async function runFieldNodeCommand(action: FieldNodeCommandAction): Promise<FieldNodeCommandResult> {
  const command = buildCommand(action);
  return await new Promise((resolve) => execFile(command.file, command.args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true }, (error, stdout, stderr) => {
    const output = [stdout, stderr].map((part) => String(part ?? "").trim()).filter(Boolean).join("\n").slice(0, MAX_OUTPUT);
    resolve({ action, ok: !error, output: output || (error?.message ?? "No output."), executedAt: Date.now() });
  }));
}

function buildCommand(action: FieldNodeCommandAction): { file: string; args: string[] } {
  const windows = process.platform === "win32";
  if (action === "ping") return windows ? { file: "ping.exe", args: ["-n", "1", "127.0.0.1"] } : { file: "ping", args: ["-c", "1", "127.0.0.1"] };
  if (action === "runtime-status") return { file: process.execPath, args: ["--version"] };
  return windows ? { file: "fsutil.exe", args: ["volume", "diskfree", "C:"] } : { file: "df", args: ["-h", "."] };
}
