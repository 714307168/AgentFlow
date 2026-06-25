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
  assert.match(removeScript, /Exec=\.\*\$EXECUTABLE_NAME/);

  assert.equal((builderConfig.match(/afterInstall: assets\/linux-after-install\.sh/g) || []).length, 2);
  assert.equal((builderConfig.match(/afterRemove: assets\/linux-after-remove\.sh/g) || []).length, 2);
});
