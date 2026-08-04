const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const testUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-workgroup-collab-test-"));
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath() {
          return testUserDataPath;
        },
        setPath() {},
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const WorkgroupCollaborationService = require("../dist/src/workgroup-collaboration-service.js").default;
const workgroupStore = require("../dist/src/workgroup-store.js").default;
const workgroupCollaborationStore = require("../dist/src/workgroup-collaboration-store.js").default;

function createServiceForPolicyTest() {
  return new WorkgroupCollaborationService({
    runtimeManager: { getSnapshot() { return null; } },
    getBoundProject() { return null; },
    getProjectSessionSnapshot() { return null; },
    getRemoteSessionStore() { return null; },
  });
}

test("workgroup write policy permits one approved writer per workspace", () => {
  const service = createServiceForPolicyTest();
  const workgroup = { requireWriteApproval: true, singleWriterPerWorkspace: true };
  const writer = { executionMode: "write" };
  const reader = { executionMode: "read" };
  const project = { id: "project-1", path: "C:/workspace", kind: "local" };

  assert.equal(service.acquireWriteSlot(workgroup, writer, project, "run-1", { senderType: "user" }), null);
  assert.match(
    service.acquireWriteSlot(workgroup, writer, project, "run-2", { senderType: "user" }),
    /already running/i,
  );
  assert.equal(service.acquireWriteSlot(workgroup, reader, project, "read-1", { senderType: "member" }), null);
  service.activeWriterRunByWorkspace.clear();
  assert.match(
    service.acquireWriteSlot(workgroup, writer, project, "run-3", { senderType: "member" }),
    /human-approved/i,
  );
});

function createRemoteSnapshot(runId, content) {
  return {
    projectId: "remote-project-1",
    provider: "claude",
    model: null,
    automationMode: "full-auto",
    projectSignature: null,
    syncBucket: null,
    isRunning: true,
    queuedCount: 0,
    currentSource: "remote",
    currentPrompt: null,
    currentStartedAt: 1,
    activeConversationId: null,
    conversations: [],
    messageTotal: 1,
    activityTotal: 0,
    cliTraceTotal: 0,
    queue: [],
    cliTrace: [],
    messages: [
      {
        id: `${runId}:assistant`,
        role: "assistant",
        content,
        source: "remote",
        createdAt: 1,
        updatedAt: 1,
        status: "streaming",
      },
    ],
    activities: [],
    sessionRefs: {
      claudeSessionId: null,
      codexThreadId: null,
    },
  };
}

test("workgroup collaboration service does not recurse when remote streaming content is unchanged", () => {
  const workgroupId = "workgroup-recursion-guard";
  const dispatchRunId = "remote-run-1";
  const workgroup = {
    id: workgroupId,
    name: "Workgroup recursion guard",
    description: null,
    allowDirectMemberMessages: true,
    groupNumber: null,
    planWorkspacePath: null,
    registryUpdatedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const originalGetWorkgroupById = workgroupStore.getWorkgroupById.bind(workgroupStore);

  workgroupCollaborationStore.removeSession(workgroupId);
  workgroupStore.getWorkgroupById = (id) => (id === workgroupId ? workgroup : undefined);
  try {
    const persistedMessage = workgroupCollaborationStore.appendMessage(workgroupId, {
      id: "reply-message-1",
      senderType: "member",
      senderName: "Remote member",
      memberId: "member-1",
      memberRole: "member",
      projectId: "remote-project-1",
      projectKind: "remote",
      dispatchRunId,
      triggerMessageId: "user-message-1",
      content: "same remote chunk",
      status: "streaming",
    });

    const service = new WorkgroupCollaborationService({
      runtimeManager: {
        getSnapshot() {
          return null;
        },
      },
      getBoundProject(projectId) {
        if (projectId !== "remote-project-1") {
          return null;
        }
        return {
          id: projectId,
          name: "Remote project",
          path: "C:/remote/project",
          kind: "remote",
          online: true,
        };
      },
      getProjectSessionSnapshot(projectId) {
        if (projectId !== "remote-project-1") {
          return null;
        }
        return createRemoteSnapshot(dispatchRunId, "same remote chunk");
      },
      getRemoteSessionStore() {
        return null;
      },
    });

    const snapshot = service.getSession(workgroupId);
    const storedMessage = workgroupCollaborationStore.getMessage(workgroupId, persistedMessage.id);

    assert.ok(snapshot);
    assert.equal(snapshot.messages.length, 1);
    assert.equal(snapshot.messages[0].content, "same remote chunk");
    assert.ok(storedMessage);
    assert.equal(storedMessage.updatedAt, persistedMessage.updatedAt);
  } finally {
    workgroupStore.getWorkgroupById = originalGetWorkgroupById;
    workgroupCollaborationStore.removeSession(workgroupId);
  }
});

test("workgroup collaboration service broadcasts plain messages and honors mentions", async () => {
  const workgroupId = "workgroup-passive-chat";
  const workgroup = {
    id: workgroupId,
    name: "Passive chat",
    description: null,
    allowDirectMemberMessages: true,
    groupNumber: null,
    planWorkspacePath: null,
    registryUpdatedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const originalGetWorkgroupById = workgroupStore.getWorkgroupById.bind(workgroupStore);
  workgroupStore.removeWorkgroup(workgroupId);
  workgroupStore.getWorkgroupById = (id) => (id === workgroupId ? workgroup : undefined);
  const members = [
    workgroupStore.saveMember({
      workgroupId,
      name: "Desktop member",
      role: "member",
      kind: "project",
      projectId: "local-project-1",
      projectName: "Local project",
      projectPath: "D:/repo/local-project-1",
      projectKind: "local",
      allowedPaths: [],
    }),
    workgroupStore.saveMember({
      workgroupId,
      name: "Second member",
      role: "member",
      kind: "project",
      projectId: "local-project-2",
      projectName: "Second local project",
      projectPath: "D:/repo/local-project-2",
      projectKind: "local",
      allowedPaths: [],
    }),
  ];
  workgroupCollaborationStore.removeSession(workgroupId);
  const enqueued = [];

  try {
    assert.equal(workgroupStore.listMembers(workgroupId).length, 2);
    const service = new WorkgroupCollaborationService({
      runtimeManager: {
        enqueueMessage(options) {
          enqueued.push(options);
          queueMicrotask(() => options.onDone?.());
        },
        getSnapshot() {
          return null;
        },
      },
      getBoundProject(projectId) {
        if (!members.some((member) => member.projectId === projectId)) {
          return null;
        }
        return {
          id: projectId,
          name: projectId === "local-project-1" ? "Local project" : "Second local project",
          path: `D:/repo/${projectId}`,
          kind: "local",
          online: true,
        };
      },
      getProjectSessionSnapshot() {
        return null;
      },
      getRemoteSessionStore() {
        return null;
      },
    });

    const result = await service.sendUserMessage(workgroupId, "大家先看下这个问题");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(result.success, true);
    assert.equal(enqueued.length, 2);
    assert.deepEqual(enqueued.map((entry) => entry.projectId).sort(), ["local-project-1", "local-project-2"]);
    assert.ok(enqueued.every((entry) => entry.prompt.includes("大家先看下这个问题")));
    assert.ok(result.session);
    assert.ok(result.session.messages.some((message) => (
      message.senderType === "user" && message.content === "大家先看下这个问题"
    )));

    enqueued.length = 0;
    await service.sendUserMessage(workgroupId, "@Desktop member 只检查本地项目");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].projectId, "local-project-1");

    enqueued.length = 0;
    const unmatchedResult = await service.sendUserMessage(workgroupId, "@不存在的成员 请处理");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(enqueued.length, 0);
    assert.ok(unmatchedResult.session.messages.some((message) => (
      message.senderType === "error" && message.content.includes("@不存在的成员")
    )));
  } finally {
    workgroupStore.getWorkgroupById = originalGetWorkgroupById;
    workgroupStore.removeWorkgroup(workgroupId);
    workgroupCollaborationStore.removeSession(workgroupId);
  }
});
