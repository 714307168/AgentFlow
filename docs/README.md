# Documentation Index

This directory stores product design notes, deployment runbooks, release templates, and roadmap records for AgentFlow.

Use this page as the main documentation entry. The root README should stay product-focused and only link to the most important entry points.

## How To Read

- New reader: start with [README](../README.md), then [Architecture Overview](./architecture-overview.md).
- Developer: read [CLAUDE.md](../CLAUDE.md), [Architecture Overview](./architecture-overview.md), and the feature document for the area you are changing.
- Release operator: read [Release Upload Runbook](./release-upload-runbook.md), [Release And Update Center](./release-and-update-center.md), and [Release Consistency Checklist](./release-consistency-checklist.md).
- Incident/debugging: start with [Message Sync Update Troubleshooting](./message-sync-update-troubleshooting.md), [Log Signal Diagnostic Mapping](./log-signal-diagnostic-mapping.md), and [Release Ops Signal Decision Template](./release-ops-signal-decision-template.md).
- Planning work: use [2026-05 Roadmap](./roadmap-2026-05.md) as the current roadmap entry. Older roadmap files are historical reference.

## Documentation Rules

- Keep root README readable for users. Do not turn it into a full document dump.
- Prefer updating an existing feature document before creating a new one.
- For scheduled optimization tasks, prioritize implementation from existing documents first. Write new documents only after documented features are done or when a missing design blocks development.
- Keep release artifacts, server IPs, credentials, APKs, installers, databases, and local-only scripts out of Git.
- If a document becomes a template or example, put that role in the title or summary so readers do not confuse it with active product scope.
- When adding a document, add it to one section below.

## Core Product Docs

- [Architecture Overview](./architecture-overview.md) - desktop, Android, relay, and sync boundaries.
- [Mobile To Desktop Execution Chain](./mobile-to-desktop-execution-chain.md) - how a phone message becomes desktop-side execution.
- [Controlled Remote Authorization](./controlled-remote-authorization.md) - remote authorization and controlled collaboration model.
- [Local Agent README](../local-agent/README.md) - desktop runtime notes, local files, and migration details.
- [English README](../README.en.md) - English product introduction.

## Deployment And Release

- [Relay Server Deployment](./relay-server-deployment.md) - relay deployment guide.
- [Relay Server Deployment EN](./relay-server-deployment.en.md) - English relay deployment guide.
- [Release And Update Center](./release-and-update-center.md) - update center model, APIs, storage, and admin flow.
- [Release Upload Runbook](./release-upload-runbook.md) - build, upload, and verification flow.
- [GitHub Releases](./github-releases.md) - GitHub Release publishing notes.
- [GitHub CI/CD And Platform Support](./github-cicd-and-platform-support.md) - GitHub Actions pipeline and multi-platform support boundary.
- [Release Consistency Checklist](./release-consistency-checklist.md) - pre-release consistency checks.
- [Release Rollback And Retract Template](./release-rollback-and-retract-template.md) - rollback and release retract checklist.

## Troubleshooting And Operations

- [Message Sync Update Troubleshooting](./message-sync-update-troubleshooting.md) - common sync, message, and update failures.
- [Log Signal Diagnostic Mapping](./log-signal-diagnostic-mapping.md) - log signal to diagnostic action mapping.
- [Ops Signal Remediation Template](./ops-signal-remediation-template.md) - operations remediation record template.
- [Release Ops Signal Decision Template](./release-ops-signal-decision-template.md) - decide observe, hotfix, rollback, or close.
- [WebSocket Stability And Recovery Plan](./ws-stability-and-recovery-plan.md) - WebSocket stability plan and progress.
- [WebSocket Hardening Joint Verification Template](./ws-hardening-joint-verification-template.md) - joint verification checklist.
- [Release Incident Writeback Template](./release-incident-writeback-template.md) - release incident writeback.

## Feature Design And Acceptance

- [Project Sync Signature Design](./project-sync-signature-design.md) - project sync signature design.
- [Cold Project Sync Acceptance](./cold-project-sync-acceptance.md) - cold project sync and project signature acceptance.
- [Transfer Protocol And Receipt Checklist](./transfer-protocol-and-receipt-checklist.md) - cross-end file transfer and receipt rules.
- [Android Interaction Optimization](./android-interaction-optimization.md) - Android interaction design optimization.
- [Swarm Workspace Design](./swarm-workspace-design.md) - forced workgroup migration, multi-account/multi-model collaboration, and execution isolation.
- [Scheduled Tasks Design](./scheduled-tasks-design.md) - scheduled task design.
- [Project Scope Access MVP](./project-scope-access-mvp.md) - project-scoped access MVP design.
- [Project Scope Access Checklist](./project-scope-access-checklist.md) - three-end implementation and release checklist.
- [Project Scope Access API Schema](./project-scope-access-api-schema.md) - project-scoped access API schema.
- [Project Scope Access Desktop UI Sketch](./project-scope-access-desktop-ui-sketch.md) - desktop UI sketch.
- [Project Scope Access Android Scope Sequence](./project-scope-access-android-scope-sequence.md) - Android scope shrink and cache cleanup sequence.

## Platform Expansion

- [Platform Expansion Plan](./platform-expansion-plan.md) - multi-platform expansion plan.
- [mac First Release Checklist](./mac-first-release-checklist.md) - mac first release checklist.
- [iOS Safe Track Plan](./ios-safe-track-plan.md) - iOS safe-track scope.
- [Mini Program Lite Boundary](./mini-program-lite-boundary.md) - WeChat Mini Program Lite boundary.
- [Multi-End Launch Acceptance Template](./multi-end-launch-acceptance-template.md) - multi-end first launch acceptance.

## Roadmaps And Reviews

- [2026-05 Roadmap](./roadmap-2026-05.md) - current roadmap overview.
- [2026-04 Roadmap](./roadmap-2026-04.md) - historical roadmap record.
- [golutra Review And Optimization Plan](./golutra-review-and-optimization-plan.md) - external project review and optimization notes.

## Release Summary Templates

- [Release Writeback Template](./release-writeback-template.md)
- [Release Hotfix Summary Template](./release-hotfix-summary-template.md)
- [Release Post Release Observation Template](./release-post-release-observation-template.md)
- [Release Observation Closure Template](./release-observation-closure-template.md)
- [Single-End Release Summary Template](./single-end-release-summary-template.md)
- [Single-End Hotfix Observation Closure Template](./single-end-hotfix-observation-closure-template.md)
- [Multi-End Release Summary Template](./multi-end-release-summary-template.md)
- [Multi-End First Release Writeback Examples](./multi-end-first-release-writeback-examples.md)
- [Release Roadmap Writeback Examples](./release-roadmap-writeback-examples.md)

## Platform Track Templates And Examples

- [Platform First Release Summary Template](./platform-first-release-summary-template.md)
- [Platform First Post Release Observation Template](./platform-first-post-release-observation-template.md)
- [Platform First Boundary Writeback Examples](./platform-first-boundary-writeback-examples.md)
- [Platform First Risk Writeback Examples](./platform-first-risk-writeback-examples.md)
- [Platform Track Roadmap Writeback Examples](./platform-track-roadmap-writeback-examples.md)
- [Platform Track Closure Summary Template](./platform-track-closure-summary-template.md)
- [Platform Track Stage Transition Writeback Examples](./platform-track-stage-transition-writeback-examples.md)
- [Platform Track Stage Closure Writeback Examples](./platform-track-stage-closure-writeback-examples.md)
- [Platform Track Pause Writeback Examples](./platform-track-pause-writeback-examples.md)
- [Platform Track Restart Writeback Examples](./platform-track-restart-writeback-examples.md)
- [Platform Track Next Cycle Writeback Examples](./platform-track-next-cycle-writeback-examples.md)
- [Platform Track Substage Writeback Examples](./platform-track-substage-writeback-examples.md)
- [Platform Track Maintenance Writeback Examples](./platform-track-maintenance-writeback-examples.md)
- [Platform Track Rescope Writeback Examples](./platform-track-rescope-writeback-examples.md)
- [Platform Track Reupgrade Writeback Examples](./platform-track-reupgrade-writeback-examples.md)
- [Platform Track Launch Delay Writeback Examples](./platform-track-launch-delay-writeback-examples.md)
- [Platform Track Acceptance Failure Writeback Examples](./platform-track-acceptance-failure-writeback-examples.md)
- [Platform Track Multi Delay Writeback Examples](./platform-track-multi-delay-writeback-examples.md)
- [Platform Track Accepted But Not Launching Writeback Examples](./platform-track-accepted-but-not-launching-writeback-examples.md)
- [Platform Track Missed Launch Window Writeback Examples](./platform-track-missed-launch-window-writeback-examples.md)
- [Platform Track Reenter Launch Prep Writeback Examples](./platform-track-reenter-launch-prep-writeback-examples.md)
- [Platform Track Launch Window Moved Up Writeback Examples](./platform-track-launch-window-moved-up-writeback-examples.md)
- [Platform Track Reenter Launch Prep Rescope Again Writeback Examples](./platform-track-reenter-launch-prep-rescope-again-writeback-examples.md)
