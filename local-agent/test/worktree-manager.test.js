const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WorktreeManager = require("../dist/src/worktree-manager.js").default;

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-worktree-test-"));
  git(root, ["init"]);
  git(root, ["config", "user.email", "tests@agentflow.local"]);
  git(root, ["config", "user.name", "AgentFlow tests"]);
  fs.writeFileSync(path.join(root, "README.md"), "# Test\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "Initial commit"]);
  return root;
}

test("member worktrees use a stable branch and can be safely removed when clean", async () => {
  const root = createRepository();
  const manager = new WorktreeManager();
  const workgroupId = "group/one";
  const memberId = "member:one";
  const branchName = manager.getMemberBranchName(workgroupId, memberId);

  const worktreePath = await manager.ensureMemberWorktree(root, workgroupId, memberId);
  assert.equal(git(worktreePath, ["branch", "--show-current"]), branchName);
  assert.equal(await manager.ensureMemberWorktree(root, workgroupId, memberId), worktreePath);

  assert.equal(await manager.removeMemberWorktree(root, workgroupId, memberId), true);
  assert.equal(fs.existsSync(worktreePath), false);
  assert.equal(git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`]), "");
});

test("member worktree cleanup preserves uncommitted work", async () => {
  const root = createRepository();
  const manager = new WorktreeManager();
  const worktreePath = await manager.ensureMemberWorktree(root, "group", "member");
  fs.writeFileSync(path.join(worktreePath, "draft.txt"), "keep me\n");

  await assert.rejects(
    manager.removeMemberWorktree(root, "group", "member"),
    /uncommitted changes/,
  );
  assert.equal(fs.existsSync(path.join(worktreePath, "draft.txt")), true);
});
