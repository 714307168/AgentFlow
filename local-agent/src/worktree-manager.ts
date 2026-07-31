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
  getMemberBranchName(workgroupId: string, memberId: string): string {
    return `agentflow/${safeSegment(workgroupId)}/${safeSegment(memberId)}`;
  }

  private getMemberWorktreePath(root: string, workgroupId: string, memberId: string): string {
    return path.join(
      path.dirname(root),
      `${path.basename(root)}.agentflow-worktrees`,
      safeSegment(workgroupId),
      safeSegment(memberId),
    );
  }

  private async getRepositoryRoot(basePath: string): Promise<string> {
    const root = await git(basePath, ["rev-parse", "--show-toplevel"]);
    if (!root) {
      throw new Error("The member project is not a Git worktree.");
    }
    return root;
  }

  async ensureMemberWorktree(basePath: string, workgroupId: string, memberId: string): Promise<string> {
    const root = await this.getRepositoryRoot(basePath);
    const worktreePath = this.getMemberWorktreePath(root, workgroupId, memberId);
    try {
      await git(worktreePath, ["rev-parse", "--is-inside-work-tree"]);
      return worktreePath;
    } catch {
      await fs.mkdir(path.dirname(worktreePath), { recursive: true });
      await git(root, ["worktree", "prune"]);
      const branchName = this.getMemberBranchName(workgroupId, memberId);
      let branchExists = true;
      try {
        await git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`]);
      } catch {
        branchExists = false;
      }
      if (branchExists) {
        await git(root, ["worktree", "add", worktreePath, branchName]);
      } else {
        await git(root, ["worktree", "add", "-b", branchName, worktreePath, "HEAD"]);
      }
      return worktreePath;
    }
  }

  async removeMemberWorktree(basePath: string, workgroupId: string, memberId: string): Promise<boolean> {
    const root = await this.getRepositoryRoot(basePath);
    const worktreePath = this.getMemberWorktreePath(root, workgroupId, memberId);
    try {
      await git(worktreePath, ["rev-parse", "--is-inside-work-tree"]);
    } catch {
      return false;
    }
    const status = await git(worktreePath, ["status", "--porcelain"]);
    if (status) {
      throw new Error("The member worktree has uncommitted changes and was kept.");
    }
    await git(root, ["worktree", "remove", worktreePath]);
    await git(root, ["worktree", "prune"]);
    return true;
  }
}
