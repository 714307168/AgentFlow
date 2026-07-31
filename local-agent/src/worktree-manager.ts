import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function safeSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "member";
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], { windowsHide: true });
  return result.stdout.trim();
}

export default class WorktreeManager {
  async ensureMemberWorktree(basePath: string, workgroupId: string, memberId: string): Promise<string> {
    const root = await git(basePath, ["rev-parse", "--show-toplevel"]);
    if (!root) {
      throw new Error("The member project is not a Git worktree.");
    }
    const worktreePath = path.join(
      path.dirname(root),
      `${path.basename(root)}.agentflow-worktrees`,
      safeSegment(workgroupId),
      safeSegment(memberId),
    );
    try {
      await git(worktreePath, ["rev-parse", "--is-inside-work-tree"]);
      return worktreePath;
    } catch {
      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      await git(root, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
      return worktreePath;
    }
  }
}
