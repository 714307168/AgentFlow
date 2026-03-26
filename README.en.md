# Claude Code Remote

[中文](./README.md)

`Claude Code Remote` is a self-hosted remote workflow for controlling desktop Claude Code from an Android app.

```text
Android App  <-->  Relay Server  <-->  Local Agent  <-->  Claude Code CLI
```

The project contains three main parts:

- `android-app/`: Android client for project list, chat, attachments, and updates
- `local-agent/`: desktop agent that connects to the relay, runs Claude Code CLI, and stores local history
- `relay-server/`: self-hosted relay service for auth, sync, device coordination, admin UI, and update center

## Features

- Mobile access to project list, chat history, and runtime status
- Desktop execution through Claude Code CLI with sync back to mobile
- Self-hosted relay architecture
- Desktop and Android update checks
- Admin UI for users, devices, release publishing, and traffic-by-event visibility
- Per-project local history with incremental sync

## Repository Layout

```text
.
|-- android-app/   Android client
|-- local-agent/   Electron desktop agent
|-- relay-server/  Go relay server and admin UI
|-- docs/          Additional documentation
`-- CLAUDE.md      Collaboration notes
```

## How It Works

The desktop agent is the source of truth.

- Each project persists its own history
- Messages and activities carry monotonic sync sequence numbers
- Android pulls incremental data with `after_seq`
- Large histories no longer rely on full-history sync
- The relay server also serves as the update center

## Quick Start

### 1. Start the Relay Server

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

### 2. Start the Desktop Agent

```bash
cd local-agent
npm install
npm run build
npm start
```

Build a Windows installer:

```bash
cd local-agent
npm run dist:win
```

### 3. Build the Android App

```bash
cd android-app
./gradlew.bat :app:compileDebugKotlin
./gradlew.bat :app:assembleRelease
```

## Local Data

### Desktop

Default desktop data directory:

- `%APPDATA%\\claude-code-agent`

Common files:

- `config.json`: relay URL, account info, project list, default settings
- `app-settings.json`: startup, update, and logging preferences
- `i18n.json`: UI language
- `runtime-history/<projectId>.json`: project history, activities, queue, and session state

### Android

The Android app uses Room and Preferences for:

- synced messages
- per-project `lastSyncSeq`
- sign-in and update preferences

## Update Center

The update center is built into `relay-server`.

Supported behaviors:

- desktop update check
- Android update check
- optional automatic check
- optional automatic download
- install still requires user confirmation

The admin overview also exposes:

- live desktop and device connection visibility
- release publishing management
- aggregated inbound and outbound traffic grouped by relay event type

Example endpoints:

```text
/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=1.0.0&build=0
/api/update/check?platform=android&channel=stable&arch=&version=1.0.0&build=1
```

## Documentation

- [Chinese README](./README.md)
- [Release and Update Center](./docs/release-and-update-center.md)
- [Release Upload Runbook](./docs/release-upload-runbook.md)
- [Local Agent README](./local-agent/README.md)
- [CLAUDE.md](./CLAUDE.md)

## Open Source Notes

- Do not commit real production domains, server IPs, database files, release scripts, or credentials
- Keep deployment and publishing helpers local-only and ignored by Git
- Ship installers and APKs through the update center or GitHub Release attachments, not through the source repository
- Use placeholders in public docs for domains, accounts, passwords, and server addresses
