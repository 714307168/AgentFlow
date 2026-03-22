# Claude Code Remote

Remote control for desktop Claude Code through an Android app, backed by a self-hosted relay server and a desktop local agent.

```text
Android App  <-->  Relay Server  <-->  Local Agent  <-->  Claude Code CLI
```

## Repository Layout

- `android-app/`: Kotlin + Compose Android client
- `relay-server/`: Go relay server, admin UI, and update center
- `local-agent/`: Electron + TypeScript desktop agent

## What Is Implemented

- Real-time project and chat sync between desktop and Android
- Structured per-project history storage on the desktop agent
- Incremental sync based on `seq`, with Android keeping only the latest 200 interactions per project
- Self-hosted update center served by `relay-server`
- Desktop and Android update checks with optional auto-check and optional auto-download
- Manual install confirmation on both platforms

## What Is Intentionally Not Implemented

- No offline push notifications
- No Android silent install
- No desktop silent install

## Architecture

### Relay Server

Responsibilities:

- user authentication
- device and agent coordination
- WebSocket message routing
- update metadata and package distribution
- admin dashboard and release center

Key endpoints:

- `GET /health`
- `POST /api/auth/login`
- `GET /api/device/sync`
- `POST /api/agent/wakeup`
- `GET /api/update/check`
- `GET /api/update/download/{id}`
- `GET /admin/releases`
- `GET/POST/DELETE /admin/api/releases`

### Local Agent

Responsibilities:

- tray-resident desktop app
- relay connection lifecycle
- Claude Code runtime management
- structured history persistence
- incremental sync generation for Android
- desktop update check, download, and install handoff

### Android App

Responsibilities:

- project list and chat UI
- WebSocket sync with the desktop agent
- local message cache
- update check, APK download, and system installer handoff

## Incremental Sync Model

The desktop agent is the source of truth.

- each project is stored in its own history file
- each message and activity receives a monotonically increasing `seq`
- Android requests sync with `after_seq`
- the desktop only returns missing items
- Android upserts by `id + seq`
- Android trims each project to the latest 200 synced interactions

This replaced the old full-history sync because large projects could stop syncing reliably.

Relevant files:

- [session-history-store.ts](./local-agent/src/session-history-store.ts)
- [session-sync-payload.ts](./local-agent/src/session-sync-payload.ts)
- [runtime-manager.ts](./local-agent/src/runtime-manager.ts)
- [MessageRepository.kt](./android-app/app/src/main/java/com/claudecode/remote/domain/MessageRepository.kt)

## Update Center

The update center is fully self-hosted inside `relay-server`.

Client policy on both platforms:

- manual update check is always supported
- automatic update check is optional
- automatic package download is optional
- installation always requires a manual user action

Desktop example:

```text
/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=1.0.0&build=0
```

Android example:

```text
/api/update/check?platform=android&channel=stable&arch=&version=1.0.0&build=1
```

Release center UI:

- `https://relay.example.com/admin/releases`

Server-side package storage:

- `DATA_DIR/releases/`

See [docs/release-and-update-center.md](./docs/release-and-update-center.md) for the full release flow.

## Local Data

### Desktop

User data directory:

- `%APPDATA%\claude-code-agent`

Important files:

- `config.json`: relay config, account fields, and project list
- `app-settings.json`: startup and update settings
- `i18n.json`: UI language
- `runtime-history/<projectId>.json`: structured per-project runtime history

Legacy `runtime-sessions.json` data is migrated into `runtime-history/`.

### Android

Android uses Room and preferences for:

- `lastSyncSeq` per project
- `syncSeq` per message
- auto update preferences

## Build Commands

### Relay Server

```bash
cd relay-server
go build ./...
go test ./...
```

Common environment variables:

- `PORT`
- `JWT_SECRET`
- `LOG_LEVEL`
- `CORS_ORIGINS`
- `DATA_DIR`
- `DATABASE_PATH`
- `ADMIN_USER`
- `ADMIN_PASSWORD`

### Local Agent

```bash
cd local-agent
npm install
npm run build
npm start
npm run dist:win
```

Expected installer output:

- `local-agent/release/Claude Code Agent-<version>-x64-setup.exe`

### Android

```bash
cd android-app
./gradlew.bat :app:compileDebugKotlin
./gradlew.bat :app:assembleRelease
```

Expected APK output:

- `android-app/app/build/outputs/apk/release/app-release.apk`

## Relay Deployment

Use the root deployment script:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-relay-server.local.ps1
```

The script does all of the following:

1. runs `go test ./...`
2. cross-compiles Linux `amd64`
3. uploads the new binary
4. restarts the `relay-server` systemd service
5. verifies local and public health checks
6. verifies the deployed binary SHA-256
7. rolls back automatically on failure

For the full release flow including package build, relay deployment, and update-center upload, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\publish-release.local.ps1
```

## Production Endpoints

- Relay and Admin: `https://relay.example.com`
- Health: `https://relay.example.com/health`
- Release Center: `https://relay.example.com/admin/releases`

## Related Docs

- [docs/release-and-update-center.md](./docs/release-and-update-center.md)
- [docs/release-upload-runbook.md](./docs/release-upload-runbook.md)
- [local-agent/README.md](./local-agent/README.md)
- [CLAUDE.md](./CLAUDE.md)
