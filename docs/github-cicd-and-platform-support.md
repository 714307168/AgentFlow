# GitHub CI/CD And Platform Support

Updated: 2026-06-25

This document records the automated GitHub pipeline and the current platform support boundary for AgentFlow.

## 1. CI Pipeline

Workflow: `.github/workflows/ci.yml`

Triggers:
- Pull request
- Push to `main`, `master`, or `develop`

Checks:
- Desktop: install `local-agent` dependencies and run `npm run build` on Windows.
- Relay server: run `go test ./...` in `relay-server` on Linux.
- Android: run `assembleDebug` in `android-app` on Linux.

The Android build keeps generated files inside the project build directory on ASCII CI paths. On local non-ASCII checkout paths, Gradle automatically falls back to an ASCII build root. Full desktop and Android unit-test suites are still required in the local release flow before publishing client versions.

## 2. Release Pipeline

Workflow: `.github/workflows/release.yml`

Triggers:
- Manual `workflow_dispatch`, with per-platform switches.
- Push to the release branches configured in the workflow.

Build artifacts:
- Windows: `AgentFlow-*-x64-setup.exe`
- macOS: `*.dmg`
- Linux: `*.AppImage`, Debian-compatible `*.deb`, and Arch Linux `*.pacman` / `*.pkg.tar.*`
- Android: release `*.apk`

On push releases, the workflow resolves the desktop version from `local-agent/package.json`, refreshes the matching `v*` tag, downloads all artifacts, and publishes them to the matching GitHub Release.

The workflow does not publish to the private update center by default. That step needs repository secrets and a server-side publishing command, otherwise CI would have to embed deployment credentials. Keep update-center publishing as a separate protected step until those secrets are configured.

## 3. Current Platform Status

| Platform | Current status | Notes |
| --- | --- | --- |
| Windows desktop | Supported | Existing NSIS installer flow remains the primary desktop release path. |
| Android | Supported | Existing Gradle project can build debug and release APKs. Release signing requires local or GitHub secret-backed keystore config. |
| macOS desktop | Build pipeline added | Electron Builder has DMG config. Real distribution still needs Developer ID signing, notarization, and mac update-center entries. |
| Linux desktop | Build pipeline added | AppImage, Debian-compatible `.deb`, and Arch Linux pacman packages are produced for x86_64. The `.deb` package is the preferred candidate for Debian-family desktops such as UOS/UnionTech and Kylin x86_64; non-x86 architectures such as arm64, loongarch, and mips still need separate Electron and native dependency validation. The pacman package uses an explicit Arch dependency list so removed upstream packages such as `http-parser` are not emitted by Electron Builder defaults. Need runtime verification on common distributions before treating Linux as a fully supported release. |
| iPhone / iOS | Planned, not implemented | There is no Xcode/Swift iOS project in the repository yet. CI can only be added after the app target exists and Apple signing secrets are prepared. |
| WeChat Mini Program | Planned, not implemented | Existing docs define the Lite boundary, but no mini-program project exists yet. |

## 4. macOS Release Requirements

Before publishing macOS as a supported customer release:
- Add Apple Developer ID certificate handling through GitHub Secrets or local release machine keychain.
- Add notarization credentials and staple verification.
- Decide artifact strategy: `arm64`, `x64`, or universal.
- Add update-center platform values, for example `desktop-mac` with `arm64` and/or `x64`.
- Verify CLI detection, data directory, log directory, startup behavior, and file-open behavior on real macOS.

## 5. iPhone / iOS Requirements

iOS support cannot be produced from the Android project automatically. The practical path is:
1. Create a new iOS app target, preferably SwiftUI.
2. Reuse relay-server APIs for login, project list, messages, workgroups, files, logs, and update checks.
3. Keep iOS scope as a companion client first: view status, chat, receive files, upload logs, and do lightweight actions.
4. Avoid desktop-style remote control in the first iOS release because of App Store review risk and background-execution limits.
5. Add GitHub Actions on `macos-latest` with Xcode once the iOS project exists.
6. Configure Apple signing through protected GitHub secrets before producing TestFlight or App Store builds.

## 6. Next Steps

Recommended implementation order:
1. Run the new CI workflow on GitHub and fix environment-only failures.
2. Add mac signing and notarization after the unsigned DMG build is verified.
3. Add update-center publishing from CI only after deployment secrets are configured safely.
4. Start iOS with a small SwiftUI companion app that reuses the current relay protocol instead of forking a new backend model.
