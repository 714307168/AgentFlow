const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("linux package scripts create desktop shortcuts for desktop environments", () => {
  const installScript = readProjectFile("assets/linux-after-install.sh");
  const removeScript = readProjectFile("assets/linux-after-remove.sh");
  const builderConfig = readProjectFile("electron-builder.yml");

  assert.match(installScript, /\/usr\/share\/applications\/\$\{executable\}\.desktop/);
  assert.match(installScript, /\$\{productFilename\}\.desktop/);
  assert.match(installScript, /XDG_DESKTOP_DIR/);
  assert.match(installScript, /\$home_dir\/Desktop/);
  assert.match(installScript, /\$home_dir\/桌面/);
  assert.doesNotMatch(installScript, /妗岄潰/);
  assert.match(installScript, /\/usr\/local\/bin\/\$\{executable\}/);
  assert.match(installScript, /ln -sfn/);
  assert.match(installScript, /metadata::trusted/);
  assert.match(installScript, /update-desktop-database/);
  assert.match(installScript, /gtk-update-icon-cache/);
  assert.match(installScript, /chrome-sandbox/);
  assert.match(installScript, /chmod 4755/);
  assert.match(installScript, /chown root:root/);
  assert.match(removeScript, /Exec=\.\*\$EXECUTABLE_NAME/);
  assert.match(removeScript, /\$home_dir\/桌面/);
  assert.doesNotMatch(removeScript, /妗岄潰/);
  assert.match(removeScript, /\/usr\/local\/bin\/\$\{executable\}/);
  assert.match(removeScript, /readlink/);
  assert.match(removeScript, /update-desktop-database/);
  assert.match(removeScript, /gtk-update-icon-cache/);
  assert.match(builderConfig, /linux:\n  icon: icons/);

  assert.equal((builderConfig.match(/afterInstall: assets\/linux-after-install\.sh/g) || []).length, 2);
  assert.equal((builderConfig.match(/afterRemove: assets\/linux-after-remove\.sh/g) || []).length, 2);
});

test("linux package includes hicolor icon theme assets", () => {
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    const builderIconPath = path.join(projectRoot, "assets", "icons", size + "x" + size + ".png");
    const iconPath = path.join(projectRoot, "assets", "icons", size + "x" + size, "agentflow-desktop.png");
    assert.equal(fs.existsSync(builderIconPath), true, builderIconPath + " should exist");
    assert.ok(fs.statSync(builderIconPath).size > 0, builderIconPath + " should not be empty");
    assert.equal(fs.existsSync(iconPath), true, iconPath + " should exist");
    assert.ok(fs.statSync(iconPath).size > 0, iconPath + " should not be empty");
  }
});

test("arch package keeps electron runtime dependencies installable", () => {
  const builderConfig = readProjectFile("electron-builder.yml");

  for (const dependency of [
    "alsa-lib",
    "at-spi2-core",
    "gtk3",
    "libnotify",
    "libsecret",
    "libxtst",
    "libxss",
    "nss",
    "xdg-utils",
  ]) {
    assert.match(builderConfig, new RegExp("\\n    - " + dependency + "\\n"));
  }

  assert.doesNotMatch(builderConfig, /\n    - http-parser\n/);
});
