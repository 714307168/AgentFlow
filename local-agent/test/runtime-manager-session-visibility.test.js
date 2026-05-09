const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const testUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-runtime-visibility-test-"));
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

function createMessage(id, source, role, content, timestamp) {
  return {
    id,
    role,
    content,
    source,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "done",
  };
}

function createActivity(id, source, title, timestamp) {
  return {
    id,
    kind: "status",
    title,
    detail: title,
    status: "completed",
    createdAt: timestamp,
    updatedAt: timestamp,
    meta: { source },
  };
}

test("RuntimeManager keeps workgroup chat out of project snapshots and summaries", () => {
  const runtimeManager = createRuntimeManager();
  const state = runtimeManager.ensureState("project-visibility");

  state.messages.push(
    createMessage("m-workgroup", "workgroup", "user", "workgroup title should stay hidden", 1),
    createMessage("m-project-user", "desktop", "user", "project title should stay visible", 2),
    createMessage("m-project-assistant", "desktop", "assistant", "visible reply", 3),
  );
  state.activities.push(
    createActivity("a-workgroup", "workgroup", "hidden workgroup activity", 4),
    createActivity("a-project", "desktop", "visible project activity", 5),
  );
  state.queue.push(
    {
      projectId: "project-visibility",
      cwd: process.cwd(),
      prompt: "hidden workgroup queue",
      source: "workgroup",
      runId: "q-workgroup",
      queuedAt: 6,
    },
    {
      projectId: "project-visibility",
      cwd: process.cwd(),
      prompt: "visible desktop queue",
      source: "desktop",
      runId: "q-desktop",
      queuedAt: 7,
    },
  );
  state.currentSource = "workgroup";
  state.currentPrompt = "hidden running prompt";
  state.currentStartedAt = 8;

  const snapshot = runtimeManager.getSnapshot("project-visibility");
  const [summary] = runtimeManager.listConversationSummaries("project-visibility");
  runtimeManager.rebuildProjectHistoryStore(state);
  const delta = runtimeManager.buildSyncDelta("project-visibility");

  assert.equal(snapshot.messageTotal, 2);
  assert.equal(snapshot.activityTotal, 1);
  assert.equal(snapshot.queuedCount, 1);
  assert.equal(snapshot.currentSource, null);
  assert.equal(snapshot.currentPrompt, null);
  assert.equal(snapshot.currentStartedAt, null);
  assert.deepEqual(snapshot.messages.map((entry) => entry.id), ["m-project-user", "m-project-assistant"]);
  assert.deepEqual(snapshot.activities.map((entry) => entry.id), ["a-project"]);
  assert.deepEqual(snapshot.queue.map((entry) => entry.runId), ["q-desktop"]);
  assert.equal(summary.title, "project title should stay visible");
  assert.equal(summary.messageCount, 2);
  assert.equal(summary.activityCount, 1);
  assert.deepEqual(delta.items.map((entry) => entry.id), ["m-project-user", "m-project-assistant", "activity:a-project"]);

  runtimeManager.dispose();
});

test("RuntimeManager history pages exclude workgroup-origin messages and activities", () => {
  const runtimeManager = createRuntimeManager();
  const state = runtimeManager.ensureState("project-history-visibility");

  state.messages.push(
    createMessage("m1", "desktop", "user", "visible one", 1),
    createMessage("m2", "workgroup", "user", "hidden two", 2),
    createMessage("m3", "desktop", "assistant", "visible three", 3),
  );
  state.activities.push(
    createActivity("a1", "desktop", "visible activity", 4),
    createActivity("a2", "workgroup", "hidden activity", 5),
    createActivity("a3", "desktop", "visible activity two", 6),
  );

  const messagePage = runtimeManager.getHistoryPage("project-history-visibility", "messages", { limit: 10 });
  const activityPage = runtimeManager.getHistoryPage("project-history-visibility", "activities", { limit: 10 });

  assert.equal(messagePage.total, 2);
  assert.deepEqual(messagePage.items.map((entry) => entry.id), ["m1", "m3"]);
  assert.equal(activityPage.total, 2);
  assert.deepEqual(activityPage.items.map((entry) => entry.id), ["a1", "a3"]);

  runtimeManager.dispose();
});
