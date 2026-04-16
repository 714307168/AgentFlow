const test = require("node:test");
const assert = require("node:assert/strict");

const cleanup = require("../dist/src/process-cleanup.js");

test("buildWindowsProcessTreeKillerCommand embeds the target pid in the encoded powershell payload", () => {
  const command = cleanup.buildWindowsProcessTreeKillerCommand(4321);

  assert.equal(command.command, "powershell.exe");
  assert.ok(command.args.includes("-EncodedCommand"));
  const encodedIndex = command.args.indexOf("-EncodedCommand");
  const encodedScript = command.args[encodedIndex + 1];
  const decodedScript = Buffer.from(encodedScript, "base64").toString("utf16le");
  assert.match(decodedScript, /\$rootPid = 4321/);
  assert.match(decodedScript, /Get-CimInstance Win32_Process/);
  assert.match(decodedScript, /Stop-Process -Id \$targetPid -Force/);
});

test("terminateProcessHandle kills the root handle and launches Windows tree cleanup when pid is present", () => {
  let killCalls = 0;
  const execCalls = [];
  const handle = {
    pid: 2468,
    kill() {
      killCalls += 1;
    },
  };

  cleanup.terminateProcessHandle(handle, {
    platform: "win32",
    execFileImpl(file, args, options, callback) {
      execCalls.push({ file, args, options });
      callback(null);
    },
  });

  assert.equal(killCalls, 1);
  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0].file, "powershell.exe");
  assert.equal(execCalls[0].options.windowsHide, true);
});

test("terminateProcessHandle only performs the direct kill outside Windows or without pid", () => {
  let killCalls = 0;
  const handle = {
    kill() {
      killCalls += 1;
    },
  };

  cleanup.terminateProcessHandle(handle, {
    platform: "linux",
    execFileImpl() {
      throw new Error("execFileImpl should not be called on non-Windows cleanup");
    },
  });

  assert.equal(killCalls, 1);
});
