const { existsSync, mkdirSync, copyFileSync, mkdtempSync, writeFileSync, rmSync } = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const assetsDir = path.join(rootDir, 'assets');
const requiredIcons = [
  path.join(assetsDir, 'app-icon.ico'),
  path.join(assetsDir, 'app-icon.png')
];

function ensureLinuxIconTheme() {
  const sourceIcon = path.join(assetsDir, 'app-icon.png');
  const iconSizes = [16, 32, 48, 64, 128, 256, 512];

  for (const size of iconSizes) {
    const iconRoot = path.join(assetsDir, 'icons');
    const hicolorTargetDir = path.join(iconRoot, size + 'x' + size);
    const builderIcon = path.join(iconRoot, size + 'x' + size + '.png');
    const hicolorIcon = path.join(hicolorTargetDir, 'agentflow-desktop.png');
    mkdirSync(iconRoot, { recursive: true });
    mkdirSync(hicolorTargetDir, { recursive: true });

    ensureSizedPngIcon(sourceIcon, builderIcon, size);
    ensureSizedPngIcon(sourceIcon, hicolorIcon, size);
  }
}

function ensureSizedPngIcon(sourceIcon, targetIcon, size) {
  if (existsSync(targetIcon)) {
    return;
  }

  if (!resizePngIcon(sourceIcon, targetIcon, size)) {
    copyFileSync(sourceIcon, targetIcon);
  }
}

function resizePngIcon(sourceIcon, targetIcon, size) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'agentflow-icons-'));
  const scriptPath = path.join(tempDir, 'resize-icon.ps1');
  const script = [
    'param([string]$SourceIcon, [string]$TargetIcon, [int]$IconSize)',
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Drawing',
    '$source = [System.Drawing.Image]::FromFile($SourceIcon)',
    '$bitmap = New-Object System.Drawing.Bitmap -ArgumentList $IconSize, $IconSize',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    '$graphics.Clear([System.Drawing.Color]::Transparent)',
    '$graphics.DrawImage($source, 0, 0, $IconSize, $IconSize)',
    '$bitmap.Save($TargetIcon, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$graphics.Dispose()',
    '$bitmap.Dispose()',
    '$source.Dispose()'
  ].join('\n');

  try {
    writeFileSync(scriptPath, script);
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, sourceIcon, targetIcon, String(size)],
      { stdio: 'ignore' }
    );
    return (result.status ?? 1) === 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (!requiredIcons.every(existsSync)) {
  const scriptPath = path.join(rootDir, 'scripts', 'generate-icons.ps1');
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
    { stdio: 'inherit' }
  );

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

ensureLinuxIconTheme();
console.log('Application icons are ready.');
