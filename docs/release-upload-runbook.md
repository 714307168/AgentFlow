# Release Upload Runbook

This runbook documents the exact release flow used to publish a new desktop installer, Android APK, and relay-server build to production.

It is written for the current production environment:

- Relay: `https://relay.example.com`
- Release Center: `https://relay.example.com/admin/releases`
- Server: `<SERVER_HOST>`

Do not hardcode or commit production credentials. Use local environment variables, a password manager, or the server-side env file.

## Scope

This flow covers:

1. version bump
2. desktop installer build
3. Android APK build
4. relay-server deployment
5. release package upload
6. public update verification

## One-Command Release

The repo root now includes:

- `publish-release.local.ps1`

Recommended usage:

```powershell
$env:RELAY_ADMIN_USER = '<ADMIN_USER>'
$env:RELAY_ADMIN_PASSWORD = '<ADMIN_PASSWORD>'

powershell -ExecutionPolicy Bypass -File .\publish-release.local.ps1 `
  -DesktopNotes 'Desktop release notes here.' `
  -AndroidNotes 'Android release notes here.'
```

What it does by default:

1. reads desktop and Android versions from source files
2. builds the Windows installer and Android APK
3. copies both files into `artifacts/`
4. deploys `relay-server`
5. fixes production upload prerequisites
6. uploads both packages
7. verifies `/health`, `/api/update/check`, and download links

If the release includes schema or access-control changes in `relay-server`, do not skip relay deployment.

Common flags:

- `-SkipRelayDeploy`
- `-SkipServerChecks`
- `-SkipDesktopBuild`
- `-SkipAndroidBuild`
- `-SkipDesktopUpload`
- `-SkipAndroidUpload`
- `-SkipTests`
- `-Draft`

If you want the script to repair production nginx and release-directory permissions automatically without relying on the existing deploy script defaults, also set:

```powershell
$env:RELAY_SERVER_HOST = '<SERVER_HOST>'
$env:RELAY_SERVER_USER = 'root'
$env:RELAY_SERVER_PASSWORD = '<SERVER_PASSWORD>'
```

## Version Rules

### Desktop

Desktop update checks compare the app `version`. The Windows installer must bump:

- `local-agent/package.json`

Example:

```json
{
  "version": "1.1.2"
}
```

Desktop currently uses:

- `platform=desktop-win`
- `channel=stable`
- `arch=x64`
- `build=0`

### Android

Android must bump both:

- `android-app/app/build.gradle.kts` `versionName`
- `android-app/app/build.gradle.kts` `versionCode`

Example:

```kotlin
versionCode = 4
versionName = "1.1.2"
```

Android currently uses:

- `platform=android`
- `channel=stable`
- `arch=` empty

## Build Artifacts

Set a local repo root first:

```powershell
$RepoRoot = 'D:\path\to\claude-code-remote-app-spec'
```

### Desktop Installer

```powershell
cd "$RepoRoot\local-agent"
npm install
npm run build
npm run dist:win
```

Expected output:

- `local-agent/release/Claude Code Agent-<version>-x64-setup.exe`

### Android APK

```powershell
cd "$RepoRoot\android-app"
.\gradlew.bat :app:assembleRelease
```

Expected output:

- `android-app/app/build/outputs/apk/release/app-release.apk`

### Optional: Copy Stable Release Files To `artifacts/`

```powershell
cd $RepoRoot
Copy-Item .\local-agent\release\Claude*setup.exe .\artifacts\ -Force
Copy-Item .\android-app\app\build\outputs\apk\release\app-release.apk ".\artifacts\ClaudeCodeRemote-<version>-release.apk" -Force
```

### Optional: Record SHA256

```powershell
Get-FileHash "$RepoRoot\artifacts\ClaudeCodeAgent-<version>-x64-setup.exe" -Algorithm SHA256
Get-FileHash "$RepoRoot\artifacts\ClaudeCodeRemote-<version>-release.apk" -Algorithm SHA256
```

## Deploy Relay Server

Use the root deployment script:

```powershell
cd $RepoRoot
powershell -ExecutionPolicy Bypass -File .\deploy-relay-server.local.ps1
```

The script already does:

1. `go test ./...`
2. Linux `amd64` build
3. SSH upload
4. service restart
5. local health check
6. public health check
7. deployed binary SHA256 verification
8. rollback on failure

Important for recent builds:

- deploy `relay-server` before testing multi-desktop mobile sync
- the server now migrates `agent_access_grants` automatically on startup
- desktop silent update only starts when there are no running or queued local tasks

## Production Preconditions

Before uploading a large Windows installer, confirm the production server accepts the package size.

### 1. Nginx Upload Limit

Current working setting:

- file: `/www/server/panel/vhost/nginx/relay.example.com.conf`
- required line: `client_max_body_size 200m;`

If the upload fails with `413 Request Entity Too Large`, fix it with:

```bash
sed -i 's/client_max_body_size 50m;/client_max_body_size 200m;/' /www/server/panel/vhost/nginx/relay.example.com.conf
nginx -t
nginx -s reload
```

### 2. Release Directory Ownership

`relay-server` runs as `www:www`, so this directory must be writable by that user:

- `/www/wwwroot/relay-server/data/releases`

Check:

```bash
stat -c '%U:%G %a %n' /www/wwwroot/relay-server/data/releases
```

Expected:

```text
www:www 755 /www/wwwroot/relay-server/data/releases
```

If upload fails with `failed to store uploaded file`, fix it with:

```bash
chown -R www:www /www/wwwroot/relay-server/data/releases
chmod 755 /www/wwwroot/relay-server/data/releases
```

## Upload Packages To The Release Center

The recommended path is the admin API, because it is deterministic and easy to verify.

### Step 1. Login And Capture The Admin Session Cookie

Use credentials from a secure source. Do not put real passwords into this document.

```powershell
$body = @{
  username = '<ADMIN_USER>'
  password = '<ADMIN_PASSWORD>'
} | ConvertTo-Json

$null = Invoke-RestMethod `
  -Uri 'https://relay.example.com/admin/api/login' `
  -Method Post `
  -Body $body `
  -ContentType 'application/json' `
  -SessionVariable sess

$cookie = $sess.Cookies.GetCookies('https://relay.example.com/admin/')['admin_session'].Value
if (-not $cookie) { throw 'admin_session cookie missing' }
```

### Step 2. Upload The Desktop Installer

```powershell
$desktopPkg = "$RepoRoot\artifacts\ClaudeCodeAgent-1.1.2-x64-setup.exe"

curl.exe -fsS -X POST `
  -H "Cookie: admin_session=$cookie" `
  -F 'platform=desktop-win' `
  -F 'channel=stable' `
  -F 'arch=x64' `
  -F 'version=1.1.2' `
  -F 'build=0' `
  -F 'published=true' `
  -F 'notes=Token auto-refresh, desktop session credential cache, and CLI trace cleanup.' `
  -F "package=@$desktopPkg;filename=ClaudeCodeAgent-1.1.2-x64-setup.exe" `
  https://relay.example.com/admin/api/releases
```

Expected result:

- JSON response with a new `id`
- `platform` is `desktop-win`
- `version` is the target version
- `published` is `true`

### Step 3. Upload The Android APK

```powershell
$androidPkg = "$RepoRoot\artifacts\ClaudeCodeRemote-1.1.2-release.apk"

curl.exe -fsS -X POST `
  -H "Cookie: admin_session=$cookie" `
  -F 'platform=android' `
  -F 'channel=stable' `
  -F 'arch=' `
  -F 'version=1.1.2' `
  -F 'build=4' `
  -F 'published=true' `
  -F 'notes=Token auto-refresh, draft persistence, queue while running, and crash-log management improvements.' `
  -F "package=@$androidPkg;filename=ClaudeCodeRemote-1.1.2-release.apk" `
  https://relay.example.com/admin/api/releases
```

Expected result:

- JSON response with a new `id`
- `platform` is `android`
- `build` matches the APK build
- `published` is `true`

## Verify The Public Update Chain

### Health Check

```powershell
curl.exe -fsS https://relay.example.com/health
```

Expected:

```text
ok
```

### Desktop Update Check

Replace the `version` query with an older installed version.

```powershell
curl.exe -fsS "https://relay.example.com/api/update/check?platform=desktop-win&channel=stable&arch=x64&version=1.1.1&build=0"
```

Expected:

- `"available": true`
- `"latestVersion": "1.1.2"`
- `downloadUrl` points to `/api/update/download/<id>`

### Android Update Check

Replace the `version` and `build` query with an older installed version.

```powershell
curl.exe -fsS "https://relay.example.com/api/update/check?platform=android&channel=stable&arch=&version=1.1.1&build=3"
```

Expected:

- `"available": true`
- `"latestVersion": "1.1.2"`
- `"build": 4`

### Download Endpoint Check

Use the `releaseId` returned from the check endpoint.

```powershell
curl.exe -fsSI https://relay.example.com/api/update/download/5
curl.exe -fsSI https://relay.example.com/api/update/download/6
```

Expected:

- `HTTP/1.1 200 OK`
- correct `Content-Disposition`
- expected `Content-Length`

### Multi-Desktop Access Verification

After deploying the latest `relay-server`, also verify:

1. sign in with an app account that can access more than one desktop agent
2. call `GET /api/device/sync`
3. confirm the `projects` array contains entries from multiple `agent_id` values
4. confirm the Android app still loads the merged project list correctly

## Common Failure Cases

### `413 Request Entity Too Large`

Cause:

- nginx upload limit too small

Fix:

- raise `client_max_body_size`
- reload nginx

### `failed to store uploaded file`

Cause:

- release directory not writable by `www`

Fix:

- repair ownership on `/www/wwwroot/relay-server/data/releases`

### Update Check Still Returns The Old Version

Check:

1. package was uploaded with `published=true`
2. desktop `version` really changed
3. Android `versionCode` and `versionName` both changed
4. `platform`, `channel`, and `arch` match the client request

## Recommended Release Checklist

1. Bump desktop and Android versions.
2. Build the Windows installer and APK.
3. Copy stable artifacts into `artifacts/`.
4. Record SHA256 for both packages.
5. Deploy `relay-server`.
6. Confirm nginx upload size and release directory permissions.
7. Upload desktop installer.
8. Upload Android APK.
9. Verify `/health`.
10. Verify both `/api/update/check` responses.
11. Verify both `/api/update/download/{id}` endpoints.
