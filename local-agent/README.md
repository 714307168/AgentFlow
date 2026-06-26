# AgentFlow Desktop

## Run Modes

- `npm start`: run Electron from `dist/src/main.js`
- `npm run build`: compile TypeScript and refresh renderer assets
- `npm run doctor`: print a local runtime and environment health report for this desktop host
- `npm run dist:win`: build the Windows NSIS installers for x64 and x86
- `npm run dist:win:x64`: build only the Windows x64 NSIS installer
- `npm run dist:win:x86`: build only the Windows x86 NSIS installer
- `npm run dist:win:portable`: build Windows portable packages for x64 and x86 without the NSIS installer
- `npm run dist:win:portable:x64`: build only the Windows x64 portable package
- `npm run dist:win:portable:x86`: build only the Windows x86 portable package
- `npm run dist`: build the default `electron-builder` targets

## User Data Directory

Desktop data is stored under one stable directory:

- `%APPDATA%\claude-code-agent`

This path stays unchanged for upgrade compatibility with older builds.

The app does not persist user data inside the install directory.

## Main Files

- `config.json`: relay URL, account fields, project list, default CLI settings
- `app-settings.json`: startup flags and update options such as `autoUpdateCheck` and `autoUpdateDownload`
- `i18n.json`: saved UI language
- `runtime-history/<projectId>.json`: structured per-project history, queue, runtime session IDs, messages, and activities
- `workgroup-collaborations.json`: shared workgroup collaboration messages stored locally on desktop only

## History Storage

The current implementation no longer relies on a single shared `runtime-sessions.json` file.

Instead:

- each project is stored in its own JSON file under `runtime-history/`
- every message and activity carries a `syncSeq`
- sync payloads are generated incrementally from that history

This makes large projects more reliable to sync to Android.

## Legacy Migration

Older builds could use:

- `%APPDATA%\Electron`
- `runtime-sessions.json`

Current builds migrate legacy data automatically when the stable directory is still empty.

## Desktop Updates

The desktop app uses the relay update center and follows this policy:

- optional automatic update checks
- optional automatic background download
- optional silent install when enabled in settings
- silent install only starts after local running and queued tasks are fully idle
- otherwise the installer launch remains user-confirmed

## Auth Refresh

The desktop agent refreshes both the agent token and the controller token before expiry.

- refresh scheduling is based on the server-reported `expires_at`
- long refresh delays are clamped to Node.js' maximum safe `setTimeout` range
- this avoids `TimeoutOverflowWarning` and runaway refresh loops on long-lived tokens

## System Settings

The desktop app also stores system-level preferences in `app-settings.json`.

- startup behavior
- local log persistence
- update policy
- completion sound after successful task runs

Relevant code:

- `src/update-manager.ts`
- `src/main.ts`
- `renderer/settings.html`

## Workgroup Collaboration

Workgroup collaboration sessions are now stored only on the desktop host.

- the relay only forwards device and project traffic
- shared workgroup conversation history is not persisted on the server
- member replies are mirrored into one local shared thread per workgroup

Relevant code:

- `src/workgroup-collaboration-store.ts`
- `src/workgroup-collaboration-service.ts`
- `renderer/terminal.ts`

## Packaging

Build from `local-agent/`:

```bash
npm install
npm run build
npm run dist:win
npm run dist:win:portable
```

Expected outputs:

- `release/AgentFlow-<version>-x64-setup.exe`
- `release/AgentFlow-<version>-x64-setup.exe.blockmap`
- `release/AgentFlow-<version>-ia32-setup.exe`
- `release/AgentFlow-<version>-ia32-setup.exe.blockmap`
- `release/AgentFlow-<version>-x64-portable.exe`
- `release/AgentFlow-<version>-ia32-portable.exe`
- `release/AgentFlow-<version>-x64.AppImage`
- `release/AgentFlow-<version>-amd64.deb`
- `release/AgentFlow-<version>-x86_64.pacman`
- `release/AgentFlow-<version>-x64.dmg`
- `release/AgentFlow-<version>-arm64.dmg`
- `release/win-unpacked/AgentFlow.exe`

Linux desktop packages are currently built for x64 only. Electron 29 does not publish a `linux-ia32` runtime archive, so enabling 32-bit Linux packaging would fail during CI before package creation.

## Legacy Windows / Server Startup

For older Windows environments, especially Windows Server 2016 class machines, the desktop app now supports a safer graphics startup path.

- legacy Windows build `10.0.14393` and older automatically fall back to software-safe startup switches
- you can also force this path manually with `--safe-mode`
- you can set `AGENTFLOW_SAFE_MODE=true` before launching the app if you need to keep that behavior outside shortcuts

This mode disables hardware acceleration before Electron finishes bootstrapping and applies conservative Chromium switches that are safer on older remote desktop or server environments.

## Provider Runtime Auto-Maintenance

The desktop now keeps provider runtimes healthier with two automatic behaviors:

- if a local Claude Code or Codex CLI is already installed and a newer compatible release is detected, the desktop will try to upgrade it automatically
- if no local CLI is available, the desktop can bootstrap a managed provider runtime through npm so the machine does not stay permanently blocked on a missing CLI

For npm-based provider runtime downloads and upgrades, the desktop automatically prefers a domestic npm mirror by default:

- default registry: `https://registry.npmmirror.com`
- override with `AGENTFLOW_NPM_REGISTRY` when you want to use another internal or regional mirror

## Environment Doctor

Run this from `local-agent/` when you want to verify whether the current machine is actually ready to host the desktop runtime:

```bash
npm run doctor
```

The doctor output checks:

- OS release and whether legacy safe graphics mode will be enabled
- effective local data root and whether `config.json` is present
- npm availability and the effective npm mirror
- Claude Code / Codex CLI detection, current runtime mode, and whether auto-install or auto-upgrade can run

## Related Docs

- [README.md](../README.md)
- [release-and-update-center.md](../docs/release-and-update-center.md)
