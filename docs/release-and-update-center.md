# Release And Update Center

This document describes the current release workflow and self-hosted update center.

For the step-by-step production upload flow, see:

- `docs/release-upload-runbook.md`
- `docs/release-consistency-checklist.md`

## Goal

`relay-server` is responsible for both:

- release metadata
- installer and APK distribution

Both desktop and Android clients use the same update center.

## Update Policy

Current policy:

- manual update checks are supported on both platforms
- auto-check is optional
- auto-download is optional
- desktop can optionally perform a silent install after download
- desktop silent install must wait until there are no running or queued local tasks
- Android still requires the system package installer

Not supported:

- Android silent install
- forced desktop update while local tasks are still running or queued
- offline push-triggered auto update

## Server Endpoints

### Public

- `GET /api/update/check`
- `GET /api/update/download/{id}`

Query parameters:

- `platform`
- `channel`
- `arch`
- `version`
- `build`

Examples:

```text
/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=1.0.0&build=0
/api/update/check?platform=android&channel=stable&arch=&version=1.0.0&build=1
```

### Admin

- `GET /admin/api/overview`
- `GET /admin/releases`
- `GET /admin/api/releases`
- `POST /admin/api/releases`
- `DELETE /admin/api/releases/{id}`

`/admin/api/overview` currently returns:

- summary counts
- live connection rows
- event-level inbound and outbound traffic aggregation

## Server Storage

Published files are stored under:

```text
DATA_DIR/releases/
```

Release metadata lives in the SQLite `releases` table.

Important fields:

- `platform`
- `channel`
- `arch`
- `version`
- `build`
- `filename`
- `original_filename`
- `file_path`
- `sha256`
- `size`
- `notes`
- `mandatory`
- `min_supported_version`
- `published`

## Platform Conventions

### Desktop

- `platform=desktop-win`
- `arch=x64`
- package type: NSIS installer

### Android

- `platform=android`
- `arch=` left empty
- package type: APK

## Client Behavior

### Desktop

Desktop update logic lives in:

- `local-agent/src/update-manager.ts`

Flow:

1. call `/api/update/check`
2. surface the result in the desktop settings UI
3. optionally auto-download the installer
4. verify `sha256` after download
5. if `silentUpdateInstall` is enabled and no local task is active or queued, quit the app and start the NSIS installer with `/S`
6. otherwise wait for manual confirmation

### Android

Android update logic lives in:

- `android-app/app/src/main/java/com/claudecode/remote/update/AppUpdateManager.kt`

Flow:

1. call `/api/update/check`
2. surface the result in settings and the project list banner
3. optionally auto-download the APK
4. verify `sha256` after download
5. open the system installer only after user confirmation

## Build Artifacts

### Desktop

```bash
cd local-agent
npm install
npm run build
npm run dist:win
```

Output:

- `local-agent/release/AgentFlow-<version>-x64-setup.exe`

### Android

```bash
cd android-app
./gradlew.bat :app:assembleRelease
```

Output candidates:

- `android-app/app/build/outputs/apk/release/app-release.apk`
- `D:\agentflow-android-build\AgentFlow\app\outputs\apk\release\app-release.apk`

Do not assume the local `app/build` path is always the package actually used for publishing.
The current local release scripts resolve the first available artifact from the configured Android build root and then copy that APK into `artifacts/` before upload.

## Relay Deployment

Use the root script:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy-relay-server.local.ps1
```

The script:

1. runs `go test ./...`
2. builds a Linux `amd64` binary
3. uploads it to the target server
4. restarts the `relay-server` systemd service
5. checks local and public health
6. verifies the deployed binary SHA-256
7. rolls back on failure

## Multi-Desktop Access Grants

`relay-server` now also stores one-way desktop control grants in SQLite:

- table: `agent_access_grants`
- table: `agent_access_grant_projects`
- purpose: allow user `A` to see and control user `B`'s desktop agent projects without giving `B` visibility into `A`

Current access behavior:

- mobile sync can aggregate projects from multiple accessible desktop agents
- WebSocket project broadcasts are scoped by accessible agent set and, when present, the granted project-id subset for that agent
- legacy grants without rows in `agent_access_grant_projects` continue to behave as full-agent access until they are recreated with an explicit project scope
- the public app-side grant API is `GET/POST/DELETE /api/access/grants`

This is a server-side migration only. Deploy the latest `relay-server` before relying on multi-desktop access.

## Desktop Project Guidance And Provider API Config

Desktop now supports:

- per-project guidance text
- OpenAI-compatible API key and base URL
- Claude-compatible API key and base URL

Project guidance is prepended as persistent repository context before each local CLI run.

## Recommended Release Order

1. build the Windows installer and Android APK
2. deploy the latest `relay-server`
3. open `/admin/releases`
4. upload the packages and fill in version metadata
5. verify `/admin` overview and release list are healthy
6. verify local version files, update-center metadata, and GitHub Release assets against `docs/release-consistency-checklist.md`
6. verify `/api/update/check`
7. verify `/api/update/download/{id}`

## Example URLs

- Relay: `https://relay.example.com`
- Release Center: `https://relay.example.com/admin/releases`
- Health Check: `https://relay.example.com/health`

## Verification Examples

Desktop old-version check:

```bash
curl "https://relay.example.com/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=1.0.0&build=0"
```

Android old-version check:

```bash
curl "https://relay.example.com/api/update/check?platform=android&channel=stable&arch=&version=1.0.0&build=1"
```
