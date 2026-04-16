import { execFile, type ChildProcessWithoutNullStreams } from "child_process";

export interface ProcessHandleLike {
  pid?: number;
  killed?: boolean;
  kill: () => void;
}

type ExecFileCallback = (error: Error | null) => void;
type ExecFileLike = (
  file: string,
  args: string[],
  options: { windowsHide: boolean; timeout: number },
  callback: ExecFileCallback,
) => void;

const WINDOWS_PROCESS_TREE_TIMEOUT_MS = 4_000;

export function createWindowsProcessTreeKillerScript(pid: number): string {
  return [
    `$rootPid = ${Math.trunc(pid)}`,
    "$targets = New-Object 'System.Collections.Generic.HashSet[int]'",
    "$queue = New-Object 'System.Collections.Generic.Queue[int]'",
    "$queue.Enqueue($rootPid)",
    "while ($queue.Count -gt 0) {",
    "  $current = $queue.Dequeue()",
    "  if (-not $targets.Add([int]$current)) { continue }",
    "  try {",
    "    $children = @(Get-CimInstance Win32_Process -Filter \"ParentProcessId = $current\" -ErrorAction Stop | Select-Object -ExpandProperty ProcessId)",
    "  } catch {",
    "    $children = @()",
    "  }",
    "  foreach ($child in $children) {",
    "    if ([int]$child -gt 0) { $queue.Enqueue([int]$child) }",
    "  }",
    "}",
    "$orderedTargets = @($targets.ToArray() | Sort-Object -Descending)",
    "foreach ($targetPid in $orderedTargets) {",
    "  try { Stop-Process -Id $targetPid -Force -ErrorAction Stop } catch { }",
    "}",
  ].join("\n");
}

export function buildWindowsProcessTreeKillerCommand(pid: number): { command: string; args: string[] } {
  const encodedScript = Buffer.from(
    createWindowsProcessTreeKillerScript(pid),
    "utf16le",
  ).toString("base64");
  return {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedScript,
    ],
  };
}

export function terminateProcessHandle(
  handle: ProcessHandleLike | ChildProcessWithoutNullStreams | null | undefined,
  options?: {
    platform?: NodeJS.Platform;
    execFileImpl?: ExecFileLike;
  },
): void {
  if (!handle) {
    return;
  }

  try {
    handle.kill();
  } catch {
    // Best-effort kill; cleanup should continue even if the root process is already gone.
  }

  const pid = typeof handle.pid === "number" && Number.isFinite(handle.pid) && handle.pid > 0
    ? Math.trunc(handle.pid)
    : null;
  const platform = options?.platform ?? process.platform;
  if (platform !== "win32" || !pid) {
    return;
  }

  const execFileImpl = options?.execFileImpl ?? (execFile as unknown as ExecFileLike);
  const command = buildWindowsProcessTreeKillerCommand(pid);
  try {
    execFileImpl(
      command.command,
      command.args,
      {
        windowsHide: true,
        timeout: WINDOWS_PROCESS_TREE_TIMEOUT_MS,
      },
      () => {},
    );
  } catch {
    // The direct kill already ran. Avoid surfacing cleanup-only failures to the UI.
  }
}
