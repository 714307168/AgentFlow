# CLAUDE.md

This repository contains a three-part remote control system for Claude Code:

- `local-agent/`: Electron desktop agent
- `relay-server/`: Go relay server and update center
- `android-app/`: Kotlin Android client

## Repository Guidance

- When you modify code, run the relevant tests before finishing.
- After completing the change, create a commit.
- If the work affects a release version or publishing flow, complete the corresponding release or publish step.
- Keep documentation organized through docs/README.md; avoid dumping every document link into the root README.

## Optimization Task Priority

When running scheduled or broad optimization tasks:

1. Prefer implementing features and fixes already described in existing design or roadmap documents.
2. If documented work is incomplete, continue development from those documents and update progress after the implementation lands.
3. Only write new planning documents when existing documented work is complete, unclear, or missing a design needed to unblock development.
4. If both code work and documentation cleanup are possible, code and tests take priority; documentation follows as the record of what changed.

## Main Commands

### Local Agent

```bash
cd local-agent
npm install
npm run build
npm start
npm run dist:win
```

### Relay Server

```bash
cd relay-server
go build ./...
go test ./...
./relay-server
```

### Android

```bash
cd android-app
./gradlew.bat :app:compileDebugKotlin
./gradlew.bat :app:assembleRelease
```

## Architecture Notes

### Local Agent

Important files:

- `src/main.ts`: Electron entrypoint, tray, windows, IPC, updater wiring
- `src/runtime-manager.ts`: Claude Code runtime coordination
- `src/message-router.ts`: WebSocket event routing
- `src/session-history-store.ts`: structured per-project history persistence
- `src/session-sync-payload.ts`: incremental sync payload builder
- `src/update-manager.ts`: desktop update check, download, hash verification, manual install handoff
- `renderer/settings.html`: desktop settings UI, including update toggles

### Relay Server

Important files:

- `main.go`: route registration and middleware
- `handler/update.go`: public update check and package download endpoints
- `handler/update_admin.go`: release center UI
- `db/release.go`: release table access
- `db/db.go`: schema setup and migrations

### Android

Important files:

- `MainActivity.kt`: top-level wiring
- `domain/MessageRepository.kt`: sync handling and local cache updates
- `update/AppUpdateManager.kt`: Android update flow
- `ui/settings/SettingsScreen.kt`: update toggles and status UI
- `ui/session/SessionListScreen.kt`: update banner on the project list

## Sync Model

The desktop agent is the source of truth.

- Each project has its own persisted history file.
- Messages and activities receive monotonically increasing `seq` values.
- Android requests sync with `after_seq`.
- The desktop returns only missing items in `sync_version: 2`.
- Android upserts by `id + seq`.
- Android keeps only the latest 200 synced interactions per project.

This design replaced the old full-history sync because large projects could stop syncing reliably.

## Update Model

There is no silent install on either platform.

- Desktop: optional auto check, optional auto download, manual installer launch
- Android: optional auto check, optional auto download, manual system install confirmation
- Relay server hosts both update metadata and package files

Public endpoints:

- `GET /api/update/check`
- `GET /api/update/download/{id}`

Admin release UI:

- `GET /admin/releases`

## Local Storage

### Desktop

User data directory:

- `%APPDATA%\\claude-code-agent`

Important files:

- `config.json`
- `app-settings.json`
- `i18n.json`
- `runtime-history/<projectId>.json`

Legacy `runtime-sessions.json` is migrated into the new structured history directory.

### Android

Room and preferences store:

- `lastSyncSeq` per project
- `syncSeq` per message
- auto update preferences

## Release Workflow

Use the root deployment script for the relay server:

```bash
powershell -ExecutionPolicy Bypass -File .\deploy-relay-server.local.ps1
```

Then publish packages through the relay release center or the release API.

See:

- `README.md`
- `docs/release-and-update-center.md`
