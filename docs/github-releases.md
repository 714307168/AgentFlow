# GitHub Releases

This project can publish installers and APKs to GitHub Releases without requiring the `gh` CLI.

## Prerequisites

- a GitHub personal access token with `repo` permission
- `origin` points to the target GitHub repository, or pass `-Repo owner/name`
- built artifacts already exist locally

Use either environment variable:

```powershell
$env:GITHUB_TOKEN = '<YOUR_GITHUB_TOKEN>'
```

or:

```powershell
$env:GH_TOKEN = '<YOUR_GITHUB_TOKEN>'
```

## Script

Committed script:

```text
scripts/publish-github-release.ps1
```

The script will:

1. detect the GitHub repo from `git remote origin` unless `-Repo` is provided
2. read desktop version from `local-agent/package.json`
3. read Android version from `android-app/app/build.gradle.kts`
4. default the release tag to `v<desktopVersion>`
5. auto-pick these assets when present:
   - `local-agent/release/AgentFlow-<version>-x64-setup.exe`
   - `artifacts/AgentFlow-<version>-release.apk`
   - fallback Android asset: `android-app/app/build/outputs/apk/release/app-release.apk`
6. create or update the release, then replace assets with the same filename

Optional switches:

- `-SkipDesktopAsset`
- `-SkipAndroidAsset`
- `-SkipRelayAsset`

## Typical Usage

Dry run first:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-github-release.ps1 -DryRun
```

Publish with default tag and auto-detected files:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-github-release.ps1 `
  -Notes "AgentFlow release notes here."
```

Publish to a renamed repository explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-github-release.ps1 `
  -Repo '714307168/AgentFlow' `
  -Tag 'v1.1.28' `
  -Name 'AgentFlow v1.1.28' `
  -NotesFile '.\artifacts\release-notes.md'
```

Publish with explicit asset paths:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-github-release.ps1 `
  -DesktopAsset '.\local-agent\release\AgentFlow-1.1.28-x64-setup.exe' `
  -AndroidAsset '.\artifacts\AgentFlow-1.1.28-release.apk'
```

Publish desktop only:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\publish-github-release.ps1 `
  -DesktopAsset '.\local-agent\release\AgentFlow-1.1.28-x64-setup.exe' `
  -SkipAndroidAsset `
  -SkipRelayAsset
```

## Recommended Repository Rename

Recommended GitHub repository name:

```text
AgentFlow
```

After renaming the repository on GitHub, update local remote:

```powershell
git remote set-url origin https://github.com/<owner>/AgentFlow.git
```

If your local folder name also needs to match, rename it manually outside the running workspace:

```powershell
Rename-Item 'D:\path\to\old-project-folder' 'AgentFlow'
```
