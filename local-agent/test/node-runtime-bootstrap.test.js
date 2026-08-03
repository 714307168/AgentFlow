const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildNodeRuntimeBootstrapPlan,
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
