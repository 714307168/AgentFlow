# Architecture Overview

This repository is split into three runtime surfaces:

- `local-agent/`: Electron desktop controller and local execution host
- `android-app/`: Android mobile client for project/session control
- `relay-server/`: Relay and admin backend

## Desktop

High-traffic modules:

- `src/main.ts`
  Main-process IPC, window lifecycle, relay wiring, project registry, update flow
- `src/runtime-manager.ts`
  Local CLI runtime, queueing, session persistence, conversation switching
- `src/remote-session-store.ts`
  Remote desktop session mirror, remote prompt dispatch, remote attachment upload
- `src/workgroup-collaboration-service.ts`
  Local-only shared workgroup conversation orchestration and member dispatch
- `src/workgroup-collaboration-store.ts`
  Persistent desktop-only storage for shared workgroup conversation history
- `src/message-router.ts`
  Agent-side relay message handling, remote file transfer, sync responses
- `renderer/terminal.ts`
  Desktop workspace UI
- `renderer/settings.html`
  Desktop settings UI

Recommended rule of thumb:

- Add local execution behavior in `runtime-manager.ts`
- Add remote mirror/dispatch behavior in `remote-session-store.ts`
- Add shared workgroup chat behavior in `workgroup-collaboration-service.ts`
- Add relay agent behavior in `message-router.ts`
- Keep `main.ts` focused on composition and IPC only

## Android

High-traffic modules:

- `domain/SessionRepository.kt`
  Project/session catalog sync
- `domain/MessageRepository.kt`
  Chat sync, attachment transfer, history persistence
- `ui/session/SessionListScreen.kt`
  Project list and grouped navigation
- `ui/chat/ChatScreen.kt`
  Project chat UI

Recommended rule of thumb:

- Put transport/state sync in repositories
- Keep screen composables focused on rendering and UI event forwarding
- Keep long-running connection behavior in service/update layers

## Session Sync Rules

Current cross-device session sync now follows these rules:

- Initial project open should render local cache first, then immediately request the latest session delta
- Android local cache is scoped by `projectId + conversationId`; switching conversations must reuse cached rows instead of clearing project history
- Normal sync sends lightweight message/activity/CLI summaries, but keeps `content_md5` based on the full body
- Android should compute `after_seq` from the active conversation's local max `syncSeq`, so session sync only requests conversation-level adds/updates
- If a sync item is trimmed or omitted, clients request that single `itemId` again for full content and patch it in place
- Once a client has the full body, later summary syncs should not overwrite it back to the trimmed variant
- Relay/UI should treat provider advisories such as event-stream lag or long-thread warnings as notices, not task failures

Desktop runtime also applies a context-pressure guard before the next run:

- rotate to a fresh conversation when the current thread is already too large
- rotate immediately after provider-side long-thread/context warnings
- keep project-level prompt/config in effect while resetting provider thread/session ids

## Relay

Relay and admin responsibilities should stay separated:

- WebSocket relay path: device/agent transport and auth
- Admin path: user/device/version management, live connections, and event-traffic overview

Current admin overview responsibilities:

- summary cards for users, agents, devices, and online counts
- live connection table for agents and devices
- traffic table grouped by relay event with inbound/outbound count and bytes

## Current Refactor Direction

The main structural pressure points are:

- `local-agent/src/main.ts`
- `local-agent/renderer/settings.html`
- `android-app/app/src/main/java/com/claudecode/remote/domain/MessageRepository.kt`

When extending features, prefer extracting by domain:

- `workgroup-*`
- `workgroup-collaboration-*`
- `remote-transfer-*`
- `update-*`
- `project-*`

That keeps transport, runtime, and UI changes from collapsing back into single giant files.
