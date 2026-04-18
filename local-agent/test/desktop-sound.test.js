const test = require("node:test");
const assert = require("node:assert/strict");

const { getSystemSoundCommand } = require("../dist/src/desktop-sound.js");

test("builds the Windows completion sound command", () => {
  assert.deepEqual(getSystemSoundCommand("win32"), {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$soundPath = Join-Path $env:WINDIR 'Media\\Windows Notify System Generic.wav' try {   if (Test-Path $soundPath) {     $player = New-Object System.Media.SoundPlayer $soundPath     $player.PlaySync()   } else {     [Console]::Beep(880, 220)   } } catch {   try {     [Console]::Beep(880, 220)   } catch {     [System.Media.SystemSounds]::Asterisk.Play()     Start-Sleep -Milliseconds 250   } }",
    ],
  });
});

test("builds the Windows completion sound command with a bundled sound path", () => {
  assert.deepEqual(getSystemSoundCommand("win32", {
    bundledSoundPath: "C:\\Program Files\\AgentFlow\\sounds\\Ring01.wav",
  }), {
    command: "powershell.exe",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "$soundPath = 'C:\\Program Files\\AgentFlow\\sounds\\Ring01.wav' try {   if (Test-Path $soundPath) {     $player = New-Object System.Media.SoundPlayer $soundPath     $player.PlaySync()   } else {     [Console]::Beep(880, 220)   } } catch {   try {     [Console]::Beep(880, 220)   } catch {     [System.Media.SystemSounds]::Asterisk.Play()     Start-Sleep -Milliseconds 250   } }",
    ],
  });
});

test("builds the macOS completion sound command", () => {
  assert.deepEqual(getSystemSoundCommand("darwin"), {
    command: "afplay",
    args: ["/System/Library/Sounds/Glass.aiff"],
  });
});

test("builds the Linux completion sound command", () => {
  assert.deepEqual(getSystemSoundCommand("linux"), {
    command: "canberra-gtk-play",
    args: ["-i", "complete", "-d", "AgentFlow"],
  });
});

test("returns null for unsupported platforms", () => {
  assert.equal(getSystemSoundCommand("aix"), null);
});
