const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const testUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentflow-workgroup-store-test-"));
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

const workgroupStore = require("../dist/src/workgroup-store.js").default;

test("workgroup store normalizes legacy member roles to member while preserving the virtual PM", () => {
  const workgroupId = "workgroup-role-normalization";
  workgroupStore.removeWorkgroup(workgroupId);

  workgroupStore.saveWorkgroup({
    id: workgroupId,
    name: "Role normalization",
    allowDirectMemberMessages: true,
  });

  const legacyDeveloper = workgroupStore.saveMember({
    workgroupId,
    name: "Legacy developer",
    role: "developer",
    kind: "project",
  });
  const legacyQa = workgroupStore.saveMember({
    workgroupId,
    name: "Legacy qa",
    role: "qa",
    kind: "project",
  });
  const virtualPm = workgroupStore.saveMember({
    workgroupId,
    name: "PM Agent",
    role: "project_manager",
    kind: "pm",
  });

  assert.equal(workgroupStore.getMemberById(legacyDeveloper.id)?.role, "member");
  assert.equal(workgroupStore.getMemberById(legacyQa.id)?.role, "member");
  assert.equal(workgroupStore.getMemberById(virtualPm.id)?.role, "project_manager");

  workgroupStore.removeWorkgroup(workgroupId);
});

test("workgroup store force-migrates legacy groups to guarded swarm defaults", () => {
  const workgroupId = "workgroup-swarm-migration";
  workgroupStore.removeWorkgroup(workgroupId);

  workgroupStore.store.set("workgroups", [{
    id: workgroupId,
    name: "Legacy collaboration",
    allowDirectMemberMessages: true,
    createdAt: 1,
    updatedAt: 1,
  }]);

  const migrated = workgroupStore.getWorkgroupById(workgroupId);
  assert.equal(migrated?.mode, "swarm");
  assert.equal(migrated?.swarmSchemaVersion, 2);
  assert.equal(migrated?.requireWriteApproval, true);
  assert.equal(migrated?.singleWriterPerWorkspace, true);

  const member = workgroupStore.saveMember({
    workgroupId,
    name: "Implementation agent",
    role: "member",
    executionMode: "write",
    specialty: "implementer",
  });
  assert.equal(member.executionMode, "write");
  assert.equal(member.specialty, "implementer");

  workgroupStore.removeWorkgroup(workgroupId);
});

test("workgroup store normalizes task dependencies and removes deleted references", () => {
  const workgroupId = "workgroup-task-dependencies";
  workgroupStore.removeWorkgroup(workgroupId);
  workgroupStore.saveWorkgroup({ id: workgroupId, name: "Dependency graph" });

  const foundation = workgroupStore.saveTask({ workgroupId, title: "Foundation" });
  const delivery = workgroupStore.saveTask({
    workgroupId,
    title: "Delivery",
    dependsOnIds: [foundation.id, foundation.id, "  "],
  });
  assert.deepEqual(workgroupStore.getTaskById(delivery.id)?.dependsOnIds, [foundation.id]);

  workgroupStore.removeTask(foundation.id);
  assert.deepEqual(workgroupStore.getTaskById(delivery.id)?.dependsOnIds, []);

  workgroupStore.removeWorkgroup(workgroupId);
});

test("workgroup store keeps PM task drafts separate until they are confirmed", () => {
  const workgroupId = "workgroup-task-drafts";
  workgroupStore.removeWorkgroup(workgroupId);
  workgroupStore.saveWorkgroup({ id: workgroupId, name: "Draft planning" });

  const draft = workgroupStore.saveTaskDraft({
    workgroupId,
    goal: "Prepare a safe release",
    status: "ready",
    tasks: [{
      key: "verify",
      title: "Verify release",
      description: null,
      acceptanceCriteria: "Smoke test passes",
      priority: "normal",
      assigneeMemberId: null,
      dependsOnKeys: [],
    }],
  });

  assert.equal(workgroupStore.listTasks(workgroupId).length, 0);
  assert.equal(workgroupStore.getTaskDraftById(draft.id)?.status, "ready");
  assert.equal(workgroupStore.listTaskDrafts(workgroupId)[0]?.tasks[0]?.title, "Verify release");

  workgroupStore.removeTaskDraft(draft.id);
  assert.equal(workgroupStore.listTaskDrafts(workgroupId).length, 0);
  workgroupStore.removeWorkgroup(workgroupId);
});
