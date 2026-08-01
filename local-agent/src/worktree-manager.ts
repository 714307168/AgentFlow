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

  async inspectMemberMerge(basePath: string, workgroupId: string, memberId: string): Promise<{
    root: string;
    branchName: string;
    worktreePath: string;
    ahead: number;
    behind: number;
    clean: boolean;
    conflicts: string[];
  }> {
    const root = await this.getRepositoryRoot(basePath);
    const branchName = this.getMemberBranchName(workgroupId, memberId);
    const worktreePath = this.getMemberWorktreePath(root, workgroupId, memberId);
    const status = await git(worktreePath, ["status", "--porcelain"]);
    const counts = await git(root, ["rev-list", "--left-right", "--count", `HEAD...${branchName}`]);
    const [behind, ahead] = counts.split(/\s+/).map((value) => Number(value) || 0);
    return { root, branchName, worktreePath, ahead, behind, clean: !status, conflicts: [] };
  }

  async mergeMemberWorktree(basePath: string, workgroupId: string, memberId: string): Promise<{
    success: boolean;
    merged: boolean;
    commit?: string;
    conflicts?: string[];
    error?: string;
  }> {
    const root = await this.getRepositoryRoot(basePath);
    const branchName = this.getMemberBranchName(workgroupId, memberId);
    try {
      await git(root, ["merge", "--no-ff", "--no-edit", branchName]);
      return { success: true, merged: true, commit: await git(root, ["rev-parse", "HEAD"]) };
    } catch (error) {
      let conflicts: string[] = [];
      try {
        conflicts = (await git(root, ["diff", "--name-only", "--diff-filter=U"]))
          .split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
        await git(root, ["merge", "--abort"]);
      } catch {
        // Preserve the original failure when Git cannot report or abort cleanly.
      }
      return {
        success: false,
        merged: false,
        conflicts,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async rollbackMerge(basePath: string, mergeCommit: string): Promise<{ success: boolean; error?: string }> {
    const root = await this.getRepositoryRoot(basePath);
    try {
      await git(root, ["revert", "--no-edit", "-m", "1", mergeCommit]);
      return { success: true };
    } catch (error) {
      try { await git(root, ["revert", "--abort"]); } catch { /* best effort */ }
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
