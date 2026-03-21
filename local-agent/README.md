# Local Agent

## Run Modes

- `npm start`: run Electron from `dist/src/main.js`
- `npm run build`: compile TypeScript and refresh renderer assets
- `npm run dist:win`: build the Windows NSIS installer
- `npm run dist`: build the default `electron-builder` targets

## User Data Directory

Desktop data is stored under one stable directory:

- `%APPDATA%\claude-code-agent`

The app does not persist user data inside the install directory.

## Main Files

- `config.json`: relay URL, account fields, project list, default CLI settings
- `app-settings.json`: startup flags and update options such as `autoUpdateCheck` and `autoUpdateDownload`
- `i18n.json`: saved UI language
- `runtime-history/<projectId>.json`: structured per-project history, queue, runtime session IDs, messages, and activities

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
- no silent install
- installer launch is always user-confirmed

Relevant code:

- `src/update-manager.ts`
- `src/main.ts`
- `renderer/settings.html`

## Packaging

Build from `local-agent/`:

```bash
npm install
npm run build
npm run dist:win
```

Expected outputs:

- `release/Claude Code Agent-<version>-x64-setup.exe`
- `release/Claude Code Agent-<version>-x64-setup.exe.blockmap`
- `release/win-unpacked/Claude Code Agent.exe`

## Related Docs

- [README.md](../README.md)
- [release-and-update-center.md](../docs/release-and-update-center.md)
