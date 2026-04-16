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
