const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getNpmCommand,
} = require("../dist/src/npm-package-manager.js");

test("getNpmCommand resolves platform npm binaries", () => {
  assert.equal(getNpmCommand("win32"), "npm.cmd");
  assert.equal(getNpmCommand("linux"), "npm");
  assert.equal(getNpmCommand("darwin"), "npm");
});
