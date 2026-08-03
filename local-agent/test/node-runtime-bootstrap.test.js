const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildNodeRuntimeBootstrapPlan,
  exposeWindowsNodeRuntimePaths,
  formatNodeRuntimeBootstrapPlan,
} = require("../dist/src/node-runtime-bootstrap.js");

test("buildNodeRuntimeBootstrapPlan uses non-interactive Node installers where supported", () => {
  assert.deepEqual(buildNodeRuntimeBootstrapPlan("win32"), {
    command: "winget",
    args: [
      "install",
      "--id", "OpenJS.NodeJS.LTS",
      "--exact",
      "--silent",
      "--accept-source-agreements",
      "--accept-package-agreements",
    ],
  });
  assert.deepEqual(buildNodeRuntimeBootstrapPlan("darwin"), {
    command: "brew",
    args: ["install", "node"],
  });
  assert.equal(buildNodeRuntimeBootstrapPlan("linux"), null);
  assert.match(formatNodeRuntimeBootstrapPlan(buildNodeRuntimeBootstrapPlan("win32")), /OpenJS\.NodeJS\.LTS/);
});

test("exposeWindowsNodeRuntimePaths makes global npm CLIs visible to this process", () => {
  const env = {
    ProgramFiles: "C:\\Program Files",
    APPDATA: "C:\\Users\\alice\\AppData\\Roaming",
    PATH: "C:\\Windows\\System32",
  };

  exposeWindowsNodeRuntimePaths(env);

  assert.match(env.PATH, /^C:\\Program Files\\nodejs;C:\\Users\\alice\\AppData\\Roaming\\npm;/);
  exposeWindowsNodeRuntimePaths(env);
  assert.equal(env.PATH.split(";").filter((entry) => entry.endsWith("\\nodejs")).length, 1);
  assert.equal(env.PATH.split(";").filter((entry) => entry.endsWith("\\npm")).length, 1);
});
