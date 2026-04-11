const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const testUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-codex-command-test-"));
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath(name) {
          if (name === "userData") {
            return testUserDataPath;
          }
          return testUserDataPath;
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const RuntimeManager = require("../dist/src/runtime-manager.js").default;
const {
  buildCodexExecArgs,
} = require("../dist/src/codex-command-support.js");

function createRuntimeManager(options = {}) {
  const updateCalls = [];
  const runtimeManager = new RuntimeManager(() => ({
    getProjectProvider: () => options.provider || "codex",
    getProjectModel: () => options.model || null,
    getProjectCodexWebSearchEnabled: () => options.codexWebSearchEnabled === true,
    updateProject: (_projectId, updates) => {
      updateCalls.push(updates);
    },
    onProjectConfigChanged: () => {
      options.onProjectConfigChangedCalled = true;
    },
  }));
  return { runtimeManager, updateCalls };
}

function createPreparedRun(prompt) {
  return {
    projectId: "project-codex",
    cwd: process.cwd(),
    prompt,
    source: "desktop",
    queuedAt: Date.now(),
    runId: `run-${prompt}`,
  };
}

function createRunContext() {
  return {
    runId: "context-run",
    runStatusActivityId: null,
    assistantMessageId: null,
    thinkingActivityId: null,
    activityIdsByKey: new Map(),
  };
}

test("buildCodexExecArgs enables search and resume when configured", () => {
  const args = buildCodexExecArgs({
    canResumeConversation: true,
    codexThreadId: "thread-123",
    model: "gpt-5.4",
    searchEnabled: true,
  });

  assert.deepEqual(args, [
    "exec",
    "resume",
    "--json",
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "--model",
    "gpt-5.4",
    "--search",
    "thread-123",
  ]);
});

test("RuntimeManager handles /search locally for Codex projects", async () => {
  const { runtimeManager, updateCalls } = createRuntimeManager({
    provider: "codex",
    codexWebSearchEnabled: false,
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/search on"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  assert.deepEqual(updateCalls, [{ codexWebSearchEnabled: true }]);

  const snapshot = runtimeManager.getSnapshot("project-codex");
  assert.equal(snapshot.messages.at(-1)?.content.includes("Codex web search is enabled"), true);
  assert.equal(snapshot.messages.at(-1)?.content.includes("`--search` flag"), true);

  runtimeManager.dispose();
});

test("RuntimeManager /tools reports current Codex support and search status", async () => {
  const { runtimeManager } = createRuntimeManager({
    provider: "codex",
    model: "gpt-5.4",
    codexWebSearchEnabled: true,
  });
  const state = runtimeManager.ensureState("project-codex");

  const prepared = await runtimeManager.prepareRun(
    state,
    createPreparedRun("/tools"),
    createRunContext(),
  );

  assert.equal(prepared.handledLocally, true);
  const message = runtimeManager.getSnapshot("project-codex").messages.at(-1)?.content || "";
  assert.equal(message.includes("codex exec --json"), true);
  assert.equal(message.includes("Web search tool: enabled"), true);
  assert.equal(message.includes("Not exposed in this app"), true);

  runtimeManager.dispose();
});
