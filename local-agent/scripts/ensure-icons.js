const { existsSync } = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const requiredIcons = [
  path.join(rootDir, 'assets', 'app-icon.ico'),
  path.join(rootDir, 'assets', 'app-icon.png')
];

if (requiredIcons.every(existsSync)) {
  console.log('Application icons already exist; skipping generation.');
  process.exit(0);
}

const scriptPath = path.join(rootDir, 'scripts', 'generate-icons.ps1');
const result = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
