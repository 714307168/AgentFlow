const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const testUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-runtime-manager-test-"));
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
        setPath() {},
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const RuntimeManager = require("../dist/src/runtime-manager.js").default;

function createRuntimeManager() {
  return new RuntimeManager(() => ({
    getProjectProvider: () => "claude",
    getProjectModel: () => null,
    updateProject: () => {},
  }));
}

test("RuntimeManager preserves FIFO order when queued runs share the same timestamp", () => {
  const runtimeManager = createRuntimeManager();
  const state = runtimeManager.ensureState("project-fifo");
  state.active = true;

  runtimeManager.enqueueMessage({
    projectId: "project-fifo",
    cwd: process.cwd(),
    prompt: "first prompt",
    source: "desktop",
    queuedAt: 1_700_000_000_000,
    runId: "z-run",
  });
  runtimeManager.enqueueMessage({
    projectId: "project-fifo",
    cwd: process.cwd(),
    prompt: "second prompt",
    source: "desktop",
    queuedAt: 1_700_000_000_000,
    runId: "a-run",
  });

  assert.deepEqual(
    runtimeManager.getSnapshot("project-fifo").queue.map((entry) => entry.runId),
    ["z-run", "a-run"],
  );

  runtimeManager.dispose();
});

test("RuntimeManager keeps already queued runs ahead of a newer interrupting run", () => {
  const runtimeManager = createRuntimeManager();
  const state = runtimeManager.ensureState("project-interrupt");
  state.active = true;
  state.process = {
    killCalled: false,
    kill() {
      this.killCalled = true;
    },
  };

  runtimeManager.enqueueMessage({
    projectId: "project-interrupt",
    cwd: process.cwd(),
    prompt: "queued first",
    source: "desktop",
    runId: "queued-first",
  });
  runtimeManager.enqueueMessage({
    projectId: "project-interrupt",
    cwd: process.cwd(),
    prompt: "interrupting run",
    source: "desktop",
    runId: "interrupting-run",
    interruptCurrent: true,
  });

  assert.deepEqual(
    runtimeManager.getSnapshot("project-interrupt").queue.map((entry) => entry.runId),
    ["queued-first", "interrupting-run"],
  );
  assert.equal(state.process.killCalled, true);

  runtimeManager.dispose();
});

test("RuntimeManager emits run-completed when a run ends with an error", async () => {
  const runtimeManager = createRuntimeManager();
  const completions = [];
  runtimeManager.on("run-completed", (payload) => {
    completions.push(payload);
  });
  runtimeManager.prepareRun = async () => {
    throw new Error("synthetic failure");
  };

  await new Promise((resolve) => {
    runtimeManager.enqueueMessage({
      projectId: "project-run-error",
      cwd: process.cwd(),
      prompt: "trigger failure",
      source: "desktop",
      runId: "failed-run",
      onError: () => resolve(),
    });
  });

  assert.equal(completions.length, 1);
  assert.equal(completions[0].projectId, "project-run-error");
  assert.equal(completions[0].runId, "failed-run");
  assert.equal(completions[0].finalStatus, "error");

  runtimeManager.dispose();
});
