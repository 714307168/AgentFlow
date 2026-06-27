const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLinuxDesktopPackageInstallCommand,
  isLinuxDesktopPackage,
} = require("../dist/src/update-package-install.js");

test("isLinuxDesktopPackage detects Linux package installers only on Linux", () => {
  assert.equal(isLinuxDesktopPackage("/home/lyg/.config/claude-code-agent/updates/AgentFlow-1.1.162-amd64.deb", "linux"), true);
  assert.equal(isLinuxDesktopPackage("/home/lyg/AgentFlow-1.1.162-x64.pkg.tar.zst", "linux"), true);
  assert.equal(isLinuxDesktopPackage("/home/lyg/AgentFlow-1.1.162-x64.pacman", "linux"), true);
  assert.equal(isLinuxDesktopPackage("/home/lyg/AgentFlow-1.1.162-x64.AppImage", "linux"), false);
  assert.equal(isLinuxDesktopPackage("C:/AgentFlow-1.1.162-amd64.deb", "win32"), false);
});

test("buildLinuxDesktopPackageInstallCommand returns distro package manager commands", () => {
  assert.equal(
    buildLinuxDesktopPackageInstallCommand("/home/lyg/.config/claude-code-agent/updates/AgentFlow-1.1.162-amd64.deb"),
    "sudo apt install '/home/lyg/.config/claude-code-agent/updates/AgentFlow-1.1.162-amd64.deb'",
  );
  assert.equal(
    buildLinuxDesktopPackageInstallCommand("/home/lyg/updates/AgentFlow-1.1.162-x64.pkg.tar.zst"),
    "sudo pacman -U '/home/lyg/updates/AgentFlow-1.1.162-x64.pkg.tar.zst'",
  );
});

test("buildLinuxDesktopPackageInstallCommand quotes paths safely", () => {
  assert.equal(
    buildLinuxDesktopPackageInstallCommand("/home/lyg/update's/AgentFlow.deb"),
    "sudo apt install '/home/lyg/update'\\''s/AgentFlow.deb'",
  );
});
