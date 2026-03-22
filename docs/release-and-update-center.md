# Release And Update Center

This document describes the current release workflow and self-hosted update center.

For the step-by-step production upload flow, see:

- `docs/release-upload-runbook.md`

## Goal

`relay-server` is responsible for both:

- release metadata
- installer and APK distribution

Both desktop and Android clients use the same update center.

## Update Policy

The current policy is the same on both platforms:

- manual update checks are supported
- auto-check is optional
- auto-download is optional
- installation always requires a user action

Not supported:

- Android silent install
- desktop silent install
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

- `GET /admin/releases`
- `GET /admin/api/releases`
- `POST /admin/api/releases`
- `DELETE /admin/api/releases/{id}`

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
5. launch the installer only after user confirmation

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

- `local-agent/release/Claude Code Agent-<version>-x64-setup.exe`

### Android

```bash
cd android-app
./gradlew.bat :app:assembleRelease
```

Output:

- `android-app/app/build/outputs/apk/release/app-release.apk`

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

## Recommended Release Order

1. build the Windows installer and Android APK
2. deploy the latest `relay-server`
3. open `/admin/releases`
4. upload the packages and fill in version metadata
5. verify `/api/update/check`
6. verify `/api/update/download/{id}`

## Production URLs

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
