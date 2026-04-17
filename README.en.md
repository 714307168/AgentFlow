# AgentFlow

[中文](./README.md)

`AgentFlow` is a self-hosted workflow that lets you watch, continue, and manage desktop AI coding sessions from your phone.

In plain terms, it is built for this kind of setup:

- your real coding agent runs on your computer
- when you leave the desk, you still want to check project status, read messages, send follow-up instructions, and receive files on your phone
- you do not want to hand that data to a third-party relay, so you host the sync service yourself

It is not just a chat app, and it is not a normal remote desktop tool.
It is closer to a combination of a desktop AI workspace, a mobile companion, and a self-hosted relay.

```text
Android App  <-->  Relay Server  <-->  Local Agent  <-->  Claude Code CLI / Codex CLI
```

## One-Line Summary

If you already run Claude Code CLI or Codex CLI on your computer, `AgentFlow` lets you:

- view desktop projects, chats, and runtime status on Android
- continue a project from your phone and let the local agent keep working on the computer
- receive synced messages, activities, attachments, and files from the desktop side
- control sync, devices, and updates through your own relay server

## Who It Is For

- developers who mainly run AI coding CLI tools on a Windows desktop
- teams or individuals who need a “computer executes, phone follows up” workflow
- users who want to self-host relay, account, and update infrastructure
- users who want long-lived project history instead of disposable chat sessions

If you only need remote desktop control or a standard IM app, this project is not designed for that.

## What Is Included

The repository has three main parts:

- `android-app/`
  Android client for project list, chat, file receiving, sync status, and app updates
- `local-agent/`
  Desktop agent that connects to the relay, manages local projects, runs Claude Code CLI or Codex CLI, and persists local history
- `relay-server/`
  Self-hosted relay service for auth, sync, device coordination, admin UI, and update center

## What It Actually Does

Current core capabilities include:

- viewing desktop-side project lists, conversations, and runtime status from the phone
- sending follow-up instructions from Android to a specific desktop project
- syncing messages, activities, attachments, and execution state back to mobile
- self-hosting the relay layer instead of depending on a public cloud relay
- checking and distributing desktop and Android releases through the built-in update center
- managing users, devices, releases, and traffic statistics from the admin side
- keeping per-project local history and reducing traffic through incremental sync

## A Typical Workflow

You can think of the product flow like this:

1. Install and run `local-agent` on your computer.
2. The local agent connects to Claude Code CLI or Codex CLI on that machine.
3. Deploy your own `relay-server` so both desktop and mobile connect to it.
4. Sign in with the same account on the Android app.
5. The phone can now see the projects, messages, and runtime state from the computer.
6. You send a new instruction from the phone, and the desktop side continues execution.
7. Results, activities, and files sync back to the phone.

## How It Differs From Chat Apps And Remote Desktop

- It is not a generic chat tool. The center of the design is project-based AI workflow.
- It is not remote desktop streaming. It syncs structured project data, messages, activities, and state instead of streaming the full screen.
- It is not a hosted SaaS product. You can deploy the relay server and update center yourself.
- It is not built around one-off chats. History is persisted per project for long-running work.

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

The desktop `local-agent` is the source of truth for project data.

- each project keeps its own local history
- messages and activities use monotonic sync sequence numbers
- Android pulls incremental data with `after_seq` instead of requesting the whole history every time
- large histories rely on local cache first and then patch in deltas
- the relay server also acts as the update center for release distribution

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

- `%APPDATA%\\claude-code-agent` (kept for upgrade compatibility)

Common files:

- `config.json`: relay URL, account info, project list, default settings
- `app-settings.json`: startup, update, and logging preferences
- `i18n.json`: UI language
- `runtime-history/<projectId>.json`: project history, activities, queue, and session state

### Android

The Android app uses Room and Preferences for:

- synced messages
- per-project active-conversation sync windows
- persisted chat snapshots for instant reopen
- sign-in and update preferences

## Update Center

The update center is built into `relay-server`.

Supported behaviors:

- desktop update check
- Android update check
- optional automatic check
- optional automatic download
- installation still requires user confirmation

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
- [Relay Server Deployment](./docs/relay-server-deployment.md)
- [Release and Update Center](./docs/release-and-update-center.md)
- [Release Upload Runbook](./docs/release-upload-runbook.md)
- [GitHub Releases Publishing](./docs/github-releases.md)
- [Local Agent README](./local-agent/README.md)
- [CLAUDE.md](./CLAUDE.md)

## Open Source Notes

- do not commit real production domains, server IPs, database files, release scripts, or credentials
- keep deployment and publishing helpers local-only and ignored by Git
- ship installers and APKs through the update center or GitHub Release attachments, not through the source repository
- use placeholders in public docs for domains, accounts, passwords, and server addresses
