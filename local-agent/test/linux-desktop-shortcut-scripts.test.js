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
  assert.match(installScript, /\$\{executable\}-launcher/);
  assert.match(installScript, /launcher\.log/);
  assert.match(installScript, /Exec=\$APP_WRAPPER_PATH %U/);
  assert.match(installScript, /XDG_DESKTOP_DIR/);
  assert.match(installScript, /\$home_dir\/Desktop/);
  assert.match(installScript, /\$home_dir\/桌面/);
  assert.doesNotMatch(installScript, /妗岄潰/);
  assert.match(installScript, /\/usr\/local\/bin\/\$\{executable\}/);
  assert.match(installScript, /ln -sfn/);
  assert.match(installScript, /--ozone-platform=x11/);
  assert.match(installScript, /LIBGL_ALWAYS_SOFTWARE/);
  assert.doesNotMatch(installScript, /--disable-gpu/);
  assert.doesNotMatch(installScript, /--disable-gpu-compositing/);
  assert.doesNotMatch(installScript, /disable-software-rasterizer/);
  assert.match(installScript, /metadata::trusted/);
  assert.match(installScript, /update-desktop-database/);
  assert.match(installScript, /gtk-update-icon-cache/);
  assert.match(installScript, /chrome-sandbox/);
  assert.match(installScript, /chmod 4755/);
  assert.match(installScript, /chown root:root/);
  assert.ok(
    installScript.lastIndexOf("\npatch_desktop_entry\n") < installScript.indexOf('install_for_home "/root"'),
    "system desktop entry must be patched before copying shortcuts to user desktops",
  );
  assert.match(removeScript, /Exec=\.\*\$EXECUTABLE_NAME/);
  assert.match(removeScript, /\$home_dir\/桌面/);
  assert.doesNotMatch(removeScript, /妗岄潰/);
  assert.match(removeScript, /\/usr\/local\/bin\/\$\{executable\}/);
  assert.match(removeScript, /readlink/);
  assert.match(removeScript, /update-desktop-database/);
  assert.match(removeScript, /gtk-update-icon-cache/);
  assert.match(builderConfig, /linux:\n  icon: icons/);
  assert.match(builderConfig, /mac:\n  artifactName: "\$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}"/);
  assert.match(builderConfig, /linux:[\s\S]*artifactName: "\$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}"/);
  assert.match(builderConfig, /deb:\n  artifactName: "\$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}"/);
  assert.match(builderConfig, /pacman:\n  artifactName: "\$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}"/);

  assert.equal((builderConfig.match(/afterInstall: assets\/linux-after-install\.sh/g) || []).length, 2);
  assert.equal((builderConfig.match(/afterRemove: assets\/linux-after-remove\.sh/g) || []).length, 2);
});

test("windows packages include x64 and x86 targets", () => {
  const builderConfig = readProjectFile("electron-builder.yml");
  const portableConfig = readProjectFile("electron-builder.portable.yml");

  assert.match(builderConfig, /target: nsis\n\s+arch:\n\s+- x64\n\s+- ia32/);
  assert.match(portableConfig, /target: portable\n\s+arch:\n\s+- x64\n\s+- ia32/);
  assert.match(builderConfig, /\$\{productName\}-\$\{version\}-\$\{arch\}-setup\.\$\{ext\}/);
  assert.match(portableConfig, /\$\{productName\}-\$\{version\}-\$\{arch\}-portable\.\$\{ext\}/);
});

test("desktop packages unpack node-pty native modules inside the app", () => {
  const builderConfig = readProjectFile("electron-builder.yml");
  const portableConfig = readProjectFile("electron-builder.portable.yml");

  for (const config of [builderConfig, portableConfig]) {
    assert.match(config, /asarUnpack:\n\s+- "node_modules\/node-pty\/\*\*\/\*"/);
    assert.match(config, /- "node_modules\/\*\*\/\*\.node"/);
    assert.match(config, /files:[\s\S]*- "node_modules\/node-pty\/\*\*\/\*"/);
    assert.doesNotMatch(config, /from: node_modules\/node-pty/);
  }
});

test("linux release rebuilds native dependencies before packaging", () => {
  const releaseWorkflow = fs.readFileSync(path.join(projectRoot, "..", ".github", "workflows", "release.yml"), "utf8");

  assert.match(releaseWorkflow, /container:\n\s+image: node:20-bullseye/);
  assert.match(releaseWorkflow, /Verify Linux build ABI baseline/);
  assert.match(releaseWorkflow, /electron-builder install-app-deps --platform linux --arch x64/);
});

test("release workflow preserves package artifact filenames", () => {
  const releaseWorkflow = fs.readFileSync(path.join(projectRoot, "..", ".github", "workflows", "release.yml"), "utf8");

  assert.match(releaseWorkflow, /cp "\$file" "release-assets\/\$\{base_name\}"/);
  assert.doesNotMatch(releaseWorkflow, /release-assets\/\$\{artifact_name\}-\$\{base_name\}/);
});

test("linux packages stay on x64 because current Electron releases do not provide linux ia32", () => {
  const builderConfig = readProjectFile("electron-builder.yml");
  const linuxSection = builderConfig.split("\nlinux:\n")[1].split("\ndeb:\n")[0];

  assert.match(linuxSection, /- x64/);
  assert.doesNotMatch(linuxSection, /- ia32/);
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
