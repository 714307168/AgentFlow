# Validation Report (2026-03-18)

## Scope
- End-to-end review and regression for:
  - `android-app` (device side WebSocket client and auth payload)
  - `relay-server` (JWT claims, routing, offline queue resume, admin CRUD)
  - `local-agent` (auth payload, project bind parsing, settings renderer stability)

## Fixed Issues
1. Device could send `message.send` but did not receive `message.chunk/message.done`.
   - Root cause: device JWT often missed bound `agent_id`, and broadcast filter relied on `device.AgentID`.
   - Fix:
     - generate device tokens with actual bound `agent_id`
     - set `from.AgentID` from resolved project mapping when routing `message.send`

2. `auth.resume` did not replay offline queue messages to reconnected agent.
   - Root cause: reconnected agent client instance had empty `ProjectIDs`.
   - Fix:
     - hydrate agent `ProjectIDs` from hub mappings during auth
     - add `GetProjectIDsByAgent` in hub and use it before queue drain

3. REST `/api/project/bind` payload was incompatible with local-agent parser.
   - Root cause: relay used `payload.id`, local-agent expected `payload.project_id`.
   - Fix:
     - relay now sends both `project_id` and backward-compatible `id`
     - local-agent now accepts either field

4. Potential panic/race on closed WS send channel.
   - Root cause: unregister path closed `send` while other goroutines could still write.
   - Fix:
     - add `Client.Close()` with `sync.Once`
     - guard `Send()` using `closed` channel and return error after close

5. Admin panel could not create agent/device from `/admin/api/*`.
   - Root cause: store methods returned hardcoded deprecated errors.
   - Fix:
     - implement `Store.RegisterAgent` / `Store.RegisterDevice` against SQLite

6. local-agent settings renderer could throw on missing token DOM nodes.
   - Fix:
     - null-check `tokenLabel` and `token` input before access

7. Auth payload schema mismatch between clients and relay.
   - Fix:
     - local-agent now sends `type: "agent"` and `last_seq` only on resume
     - Android now sends `type: "device"` and `device_id` in auth payload

## Files Changed
- `relay-server/db/user.go`
- `relay-server/handler/auth.go`
- `relay-server/handler/session.go`
- `relay-server/handler/project.go`
- `relay-server/handler/ws.go`
- `relay-server/hub/hub.go`
- `relay-server/hub/client.go`
- `relay-server/store/store.go`
- `local-agent/src/relay-client.ts`
- `local-agent/src/message-router.ts`
- `local-agent/renderer/settings.html`
- `android-app/app/src/main/java/com/claudecode/remote/data/remote/RelayWebSocket.kt`

## Build/Test Results
1. Local Agent
   - Command: `cd local-agent && npm run build`
   - Result: pass

2. Relay Server
   - Command: `cd relay-server && go test ./...`
   - Result: pass (no existing unit test files)

3. Android App
   - Command: `cd android-app && ./gradlew test`
   - Result: pass

4. Protocol-level E2E Regression (real relay process)
   - Verified:
     - login/auth for agent and device
     - REST `project.bind` delivery to agent
     - device -> relay -> agent -> device (`message.send/chunk/done`)
     - offline queue replay after agent `auth.resume`
     - `/api/device/sync` returns bound project
     - admin login + create/list agent/device
   - Result: pass (`E2E_PASS`, `ADMIN_CRUD_OK`)

## Remaining Risks
- No repository unit tests currently cover these paths; regressions can reappear without CI-level integration tests.
- Android UI tap-flow was not emulator-driven in this run; protocol and repository-level behavior was validated.
