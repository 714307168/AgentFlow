const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildLinuxDesktopPackageInstallPlan,
  buildLinuxDesktopPackageInstallCommand,
  isLinuxAppImage,
  isLinuxDesktopPackage,
} = require("../dist/src/update-package-install.js");

test("isLinuxDesktopPackage detects Linux package installers only on Linux", () => {
  assert.equal(isLinuxDesktopPackage("/home/lyg/.config/claude-code-agent/updates/AgentFlow-1.1.162-amd64.deb", "linux"), true);
  assert.equal(isLinuxDesktopPackage("/home/lyg/AgentFlow-1.1.162-x64.pkg.tar.zst", "linux"), true);
  assert.equal(isLinuxDesktopPackage("/home/lyg/AgentFlow-1.1.162-x64.pacman", "linux"), true);
  assert.equal(isLinuxDesktopPackage("/home/lyg/AgentFlow-1.1.162-x64.AppImage", "linux"), false);
  assert.equal(isLinuxDesktopPackage("C:/AgentFlow-1.1.162-amd64.deb", "win32"), false);
});

test("isLinuxAppImage detects AppImage updates and ignores other packages", () => {
  assert.equal(isLinuxAppImage("/home/lyg/AgentFlow-1.1.164-x64.AppImage", "linux"), true);
  assert.equal(isLinuxAppImage("/home/lyg/AgentFlow-1.1.164-amd64.deb", "linux"), false);
  assert.equal(isLinuxAppImage("C:/AgentFlow-1.1.164-x64.AppImage", "win32"), false);
});

test("buildLinuxDesktopPackageInstallPlan launches distro package managers through pkexec", () => {
  assert.deepEqual(
    buildLinuxDesktopPackageInstallPlan("/home/lyg/.config/claude-code-agent/updates/AgentFlow-1.1.164-amd64.deb"),
    {
      command: "pkexec",
      args: [
        "apt",
        "install",
        "-y",
        "/home/lyg/.config/claude-code-agent/updates/AgentFlow-1.1.164-amd64.deb",
      ],
      commandPreview: "pkexec 'apt' 'install' '-y' '/home/lyg/.config/claude-code-agent/updates/AgentFlow-1.1.164-amd64.deb'",
    },
  );

  assert.deepEqual(
    buildLinuxDesktopPackageInstallPlan("/home/lyg/updates/AgentFlow-1.1.164-x64.pkg.tar.zst"),
    {
      command: "pkexec",
      args: [
        "pacman",
        "-U",
        "--noconfirm",
        "/home/lyg/updates/AgentFlow-1.1.164-x64.pkg.tar.zst",
      ],
      commandPreview: "pkexec 'pacman' '-U' '--noconfirm' '/home/lyg/updates/AgentFlow-1.1.164-x64.pkg.tar.zst'",
    },
  );

  assert.equal(buildLinuxDesktopPackageInstallPlan("/home/lyg/AgentFlow.AppImage"), null);
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
