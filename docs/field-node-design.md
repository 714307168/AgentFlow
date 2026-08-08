# Field Node Design (v1)

## Purpose

A field node is an AgentFlow desktop agent installed at a customer site, kiosk, or remote machine. The local operator signs in, configures a readable name and location, and grants a trusted controller account access through the existing Remote Access screen. The controller can then attach that node to one or more local projects as a **field environment** or **remote machine**.

This is collaboration access, not remote-desktop access. A node never exposes an arbitrary shell, screen, environment variables, file contents, command history, or credentials.

## User Flow

1. Install AgentFlow on the site computer and sign in.
2. In Connection → Remote Access, enter the controller username and enable diagnostics if it should be available.
3. In Connection → This Device as a Field Node, set its type, name, location, and diagnostic opt-in.
4. On the controller computer, open Project Management and choose **Attach field node** on a local project. Enter the authorized Agent ID and select the mount role.
5. The controller can request the node profile, a sanitized diagnostic snapshot, or an authorized fixed command over the relay.

## Authorization and Transport

The feature reuses `agent_access_grants`; it does not introduce a second ACL.

- Profile requests require normal access to the target Agent.
- Diagnostic requests additionally require the grant's `allow_diagnostics` flag. The owner always retains access.
- Controlled command requests additionally require an active `operate` or `admin` grant.
- Each request includes the requesting controller device ID and a request ID.
- Responses are delivered only to that device, never broadcast to every controller device.
- Relay validates the controller's permission both when the request is sent and immediately before a diagnostic or command response is delivered.

Protocol events:

- `node.profile.request` / `node.profile`
- `node.diagnostics.request` / `node.diagnostics`
- `node.command.request` / `node.command.result`

## Data Boundaries

The v1 diagnostic snapshot includes hostname, OS/release/architecture, CPU count, memory totals, uptime, Node runtime version, and free disk space when the platform reports it. It intentionally excludes:

- environment variables and API keys;
- usernames, network addresses, processes, and command history;
- project paths, file names, and file contents.

Nodes can disable diagnostics locally. A disabled node returns a null diagnostic body even if the controller grant allows diagnostics.

## Project Mounts

Project records persist a small `mountedNodes` list. Each mount contains the Agent ID, node ID, role, optional label, and attachment time. Mounts are local project context: they do not alter the remote node's project catalog or grant the node any extra permission.

## Controlled Commands

There is no arbitrary remote shell. Controllers with an active **operate** or **admin** grant can request only three fixed, non-parameterized actions: a loopback ping, the packaged Node/Electron runtime version, and a local disk-space summary. The node invokes these through `execFile` with a 12-second timeout and a 16 KB output cap; no controller-provided command, path, host, environment, or shell expression reaches the process launcher. Results return only to the requesting controller device.

## Deliberate v1 Boundary

Remote desktop streaming and file transfer are not included yet. File access will use a separate root-scoped, size-limited transfer protocol and the existing independent file permission; it must not reuse project file events or become arbitrary filesystem access.

## Distribution

`AgentFlow Node` is a separate, lightweight Windows installer target. It has a dedicated Electron entry and renderer and excludes the full workbench's native runtime dependencies. The release workflow publishes it alongside the desktop installer as `AgentFlow Node-<version>-x64-setup.exe`.
