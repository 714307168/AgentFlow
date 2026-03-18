# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Three-component system for remotely controlling local Claude Code via an Android app, with a Go relay server doing minimal message routing and optional E2E encryption.

```
Android App  <—WS/HTTPS—>  Relay Server  <—WS/HTTPS—>  Local Agent
   (E2E)                    (透传)                        (E2E)
                                                            │
                                                            └── Claude Code
```

| Directory | Stack | Role |
|---|---|---|
| `local-agent/` | Electron + TypeScript | Desktop tray app, bridges Relay ↔ Claude Code via PTY |
| `relay-server/` | Go 1.21 | Public relay, JWT auth, WebSocket routing, message queue |
| `android-app/` | Kotlin + Compose | Android client, session management, settings |

## Commands

### Local Agent
```bash
cd local-agent
npm install
npm run build        # tsc compile to dist/
npm start            # electron dist/src/main.js
npm run dev          # tsc --watch
npm run rebuild      # electron-rebuild (after native dep changes)
npm run dist         # electron-builder package
```

### Relay Server
```bash
cd relay-server
go build -o relay-server ./...
./relay-server
./relay-server -port 8080 -jwt-secret "secret" -tls-cert cert.pem -tls-key key.pem
```

### Android App
Open `android-app/` in Android Studio, Sync Gradle, then Run.

## Architecture

### Local Agent (`local-agent/src/`)
- `main.ts` — Electron main process: tray, windows, IPC handlers, relay lifecycle
- `relay-client.ts` — WebSocket client connecting to relay server, handles auth + reconnect
- `message-router.ts` — Routes incoming Envelope events to PTY or project actions
- `pty-manager.ts` — Manages node-pty sessions per project (one PTY = one Claude Code instance)
- `output-parser.ts` — Parses PTY output for structured Claude Code responses
- `project-store.ts` — Persists project list via electron-store
- `crypto.ts` — X25519 key exchange + AES-256-GCM E2E encryption
- `i18n.ts` — Language store (en/zh), `t(key)` for translations, `setLang()` persists to electron-store
- `types.ts` — Shared `Envelope` type and `Events` constants
- `preload.ts` — contextBridge exposing `window.claudeAgent` API to renderer

### Renderer (`local-agent/renderer/`)
- `settings.html` — Settings window (inline JS, calls `window.claud*` IPC)
- `index.html` + `terminal.ts` — Project terminal window using xterm.js

### Relay Server (`relay-server/`)
- `main.go` — HTTP server setup, routes, CORS middleware
- `hub/hub.go` — Central message hub, manages connected clients
- `hub/client.go` — Per-connection WebSocket client
- `hub/queue.go` — Per-project offline message queue
- `handler/ws.go` — WebSocket upgrade + auth
- `handler/session.go` — REST: session token issuance
- `handler/project.go` — REST: project bind
- `handler/wakeup.go` — REST: remote wakeup trigger
- `auth/` — JWT validation and device auth
- `config/config.go` — Env var + flag config loading
- `model/envelope.go` — Shared Envelope struct

### Message Protocol
All WebSocket messages use a unified Envelope:
```json
{ "id": "uuid", "event": "message.send", "project_id": "uuid", "seq": 1, "ts": 0, "payload": {} }
```
E2E encrypted payload: `{ "encrypted": true, "ciphertext": "base64", "nonce": "base64" }`

Key events: `auth.login`, `auth.ok`, `project.bind`, `message.send/chunk/done/error`, `agent.status`, `e2e.offer/answer`, `ping/pong`

### i18n Pattern
- `i18n.ts` holds all strings for `en` and `zh`
- `setLang(lang)` updates in-memory + persists; `t(key)` reads current lang
- After language change in renderer: call `api.setLang()` then `api.getI18nMessages()` and re-apply to DOM
- Tray menu rebuilds via `rebuildTrayMenu()` on lang change (called in `set-lang` IPC handler)

### Config Storage
- Agent connection config: default electron-store (`serverUrl`, `agentId`, `token`)
- App settings: `app-settings` store (`autoStart`, `silentLaunch`)
- i18n: `i18n` store (`language`)
- E2E keys: managed in `relay-client.ts` / `crypto.ts`
- Env vars override stored config: `RELAY_SERVER_URL`, `AGENT_ID`, `AGENT_TOKEN`
