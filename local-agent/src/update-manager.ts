import { app, BrowserWindow, dialog, Notification, shell } from "electron";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { getLang } from "./i18n";
import { buildRelayApiHeaders } from "./api-version";
import {
  buildGitHubApiHeaders,
  buildGitHubUpdateCandidate,
  getGitHubReleaseApiUrl,
  type GitHubReleasePayload,
} from "./github-update-source";

type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "up_to_date" | "error";

interface UpdateReleaseInfo {
  releaseId: number;
  latestVersion: string;
  build: number;
  downloadUrl: string;
  filename?: string;
  sha256?: string;
  size?: number;
  notes?: string;
  mandatory?: boolean;
}

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  notes: string;
  mandatory: boolean;
  downloadedPath: string | null;
  message: string | null;
  lastCheckedAt: number | null;
}

interface UpdateManagerOptions {
  getServerUrl: () => string;
  getAutoCheckEnabled: () => boolean;
  getAutoDownloadEnabled: () => boolean;
  getSilentInstallEnabled: () => boolean;
  canInstallNow: () => boolean;
  prepareForSilentInstall: () => Promise<void> | void;
  getParentWindow: () => BrowserWindow | null;
}

class UpdateManager extends EventEmitter {
  private static readonly SILENT_RESTART_WAIT_STEPS = 1800;
  private static readonly SILENT_RESTART_WAIT_INTERVAL_MS = 500;
  private static readonly SILENT_RESTART_LAUNCH_RETRY_STEPS = 240;
  private static readonly SILENT_RESTART_LAUNCH_RETRY_INTERVAL_MS = 1000;
  private static readonly SILENT_RESTART_PROCESS_SETTLE_MS = 3000;
  private readonly options: UpdateManagerOptions;
  private state: UpdateState = {
    status: "idle",
    currentVersion: app.getVersion(),
    latestVersion: null,
    notes: "",
    mandatory: false,
    downloadedPath: null,
    message: null,
    lastCheckedAt: null,
  };
  private latestRelease: UpdateReleaseInfo | null = null;
  private checkTimer: NodeJS.Timeout | null = null;
  private activeCheck: Promise<void> | null = null;
  private silentInstallInFlight = false;

  constructor(options: UpdateManagerOptions) {
    super();
    this.options = options;
  }

  start(): void {
    this.stop();
    if (this.options.getAutoCheckEnabled()) {
      void this.checkForUpdates(false);
      this.checkTimer = setInterval(() => {
        if (this.options.getAutoCheckEnabled()) {
          void this.checkForUpdates(false);
        }
      }, 6 * 60 * 60 * 1000);
    }
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  async checkForUpdates(manual = false): Promise<UpdateState> {
    if (this.activeCheck) {
      await this.activeCheck;
      return this.getState();
    }

    this.activeCheck = this.performCheck(manual);
    try {
      await this.activeCheck;
    } finally {
      this.activeCheck = null;
    }
    return this.getState();
  }

  async downloadAvailableUpdate(): Promise<UpdateState> {
    if (!this.latestRelease) {
      this.setState({
        status: "error",
        message: this.text("No update is ready to download.", "当前没有可下载的更新。"),
      });
      return this.getState();
    }

    this.setState({
      status: "downloading",
      latestVersion: this.latestRelease.latestVersion,
      notes: this.latestRelease.notes ?? "",
      mandatory: Boolean(this.latestRelease.mandatory),
      message: null,
    });

    try {
      const response = await fetch(this.latestRelease.downloadUrl, {
        headers: this.buildDownloadHeaders(this.latestRelease.downloadUrl),
      });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const expectedHash = this.latestRelease.sha256?.trim().toLowerCase() ?? "";
      if (expectedHash) {
        const actualHash = createHash("sha256").update(buffer).digest("hex").toLowerCase();
        if (actualHash !== expectedHash) {
          throw new Error("Downloaded update failed SHA-256 verification.");
        }
      }

      const downloadDir = path.join(app.getPath("userData"), "updates");
      fs.mkdirSync(downloadDir, { recursive: true });
      this.clearOldUpdatePackages(downloadDir);
      const targetName = this.latestRelease.filename?.trim() || `agentflow-${this.latestRelease.latestVersion}.exe`;
      const targetPath = path.join(downloadDir, targetName);
      fs.writeFileSync(targetPath, buffer);

      this.setState({
        status: "downloaded",
        downloadedPath: targetPath,
        latestVersion: this.latestRelease.latestVersion,
        notes: this.latestRelease.notes ?? "",
        mandatory: Boolean(this.latestRelease.mandatory),
        message: null,
      });
      if (!(await this.tryInstallSilently())) {
        await this.promptToInstall();
      }
    } catch (error) {
      this.setState({
        status: "error",
        message: this.formatError(error),
      });
    }

    return this.getState();
  }

  async installDownloadedUpdate(): Promise<boolean> {
    return this.installDownloadedUpdateInternal(false);
  }

  async maybeInstallDownloadedUpdate(): Promise<boolean> {
    return this.tryInstallSilently();
  }

  private async installDownloadedUpdateInternal(silent: boolean): Promise<boolean> {
    const downloadedPath = this.state.downloadedPath;
    if (!downloadedPath || !fs.existsSync(downloadedPath)) {
      this.setState({
        status: "error",
        message: this.text("No downloaded installer is available.", "当前没有已下载的安装包。"),
      });
      return false;
    }

    if (silent) {
      try {
        await this.options.prepareForSilentInstall();
        const child = spawn(downloadedPath, ["/S"], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        this.scheduleRestartAfterSilentInstall(
          child.pid ?? null,
          this.state.latestVersion ?? this.latestRelease?.latestVersion ?? app.getVersion(),
        );
        child.unref();
        this.setState({
          message: this.text(
            "Downloaded update is installing silently.",
            "已下载的更新正在静默安装。",
          ),
        });
        setTimeout(() => {
          app.exit(0);
        }, 150);
        return true;
      } catch (error) {
        this.setState({
          status: "error",
          message: this.formatError(error),
        });
        return false;
      }
    }

    const errorMessage = await shell.openPath(downloadedPath);
    if (errorMessage) {
      this.setState({
        status: "error",
        message: this.text(
          `Failed to launch installer: ${errorMessage}`,
          `启动安装程序失败：${errorMessage}`,
        ),
      });
      return false;
    }

    this.setState({
      message: this.text(
        "Installer launched. Finish the setup to update this app.",
        "安装程序已启动，按提示完成更新即可。",
      ),
    });
    return true;
  }

  private async performCheck(manual: boolean): Promise<void> {
    this.setState({
      status: "checking",
      message: null,
    });

    try {
      this.latestRelease = await this.fetchUpdateReleaseInfo();
      if (!this.latestRelease) {
        this.markUpToDate();
        return;
      }

      this.setState({
        status: "available",
        latestVersion: this.latestRelease.latestVersion,
        notes: this.latestRelease.notes ?? "",
        mandatory: Boolean(this.latestRelease.mandatory),
        downloadedPath: null,
        message: null,
        lastCheckedAt: Date.now(),
      });

      if (this.options.getAutoDownloadEnabled()) {
        await this.downloadAvailableUpdate();
        return;
      }

      if (!manual) {
        await this.promptToDownload();
      }
    } catch (error) {
      this.latestRelease = null;
      this.setState({
        status: "error",
        message: this.formatError(error),
        lastCheckedAt: Date.now(),
      });
    }
  }

  private async fetchUpdateReleaseInfo(): Promise<UpdateReleaseInfo | null> {
    if (process.env.AGENTFLOW_UPDATE_SOURCE?.trim().toLowerCase() === "relay") {
      return this.fetchRelayUpdateReleaseInfo();
    }
    return this.fetchGitHubUpdateReleaseInfo();
  }

  private async fetchGitHubUpdateReleaseInfo(): Promise<UpdateReleaseInfo | null> {
    const response = await fetch(getGitHubReleaseApiUrl(), {
      headers: buildGitHubApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(this.text(
        `GitHub update check failed with status ${response.status}`,
        `GitHub 更新检查失败，状态码 ${response.status}`,
      ));
    }

    const payload = await response.json() as GitHubReleasePayload;
    const candidate = buildGitHubUpdateCandidate(payload, app.getVersion(), process.platform, process.arch);
    if (!candidate) {
      return null;
    }

    return {
      releaseId: candidate.releaseId,
      latestVersion: candidate.latestVersion,
      build: 0,
      downloadUrl: candidate.downloadUrl,
      filename: candidate.filename,
      sha256: candidate.sha256,
      size: candidate.size,
      notes: candidate.notes,
      mandatory: false,
    };
  }

  private async fetchRelayUpdateReleaseInfo(): Promise<UpdateReleaseInfo | null> {
    const baseUrl = this.normalizeBaseUrl(this.options.getServerUrl());
    if (!baseUrl) {
      throw new Error(this.text("Relay Server URL is not configured.", "尚未配置 Relay 服务器地址。"));
    }

    const query = new URLSearchParams({
      platform: process.platform === "win32" ? "desktop-win" : `desktop-${process.platform}`,
      channel: "stable",
      arch: process.arch,
      version: app.getVersion(),
      build: "0",
    });
    const response = await fetch(`${baseUrl}/api/update/check?${query.toString()}`, {
      headers: buildRelayApiHeaders(),
    });
    if (!response.ok) {
      throw new Error(this.text(
        `Update check failed with status ${response.status}`,
        `更新检查失败，状态码 ${response.status}`,
      ));
    }

    const payload = await response.json() as {
      available?: boolean;
      releaseId?: number;
      latestVersion?: string;
      build?: number;
      downloadUrl?: string;
      url?: string;
      filename?: string;
      sha256?: string;
      size?: number;
      notes?: string;
      mandatory?: boolean;
    };

    if (!payload.available || !payload.latestVersion || !(payload.downloadUrl || payload.url)) {
      return null;
    }

    return {
      releaseId: payload.releaseId ?? 0,
      latestVersion: payload.latestVersion,
      build: payload.build ?? 0,
      downloadUrl: payload.downloadUrl || payload.url || "",
      filename: payload.filename,
      sha256: payload.sha256,
      size: payload.size,
      notes: payload.notes,
      mandatory: payload.mandatory,
    };
  }

  private markUpToDate(): void {
    this.latestRelease = null;
    this.setState({
      status: "up_to_date",
      latestVersion: null,
      notes: "",
      mandatory: false,
      downloadedPath: null,
      message: null,
      lastCheckedAt: Date.now(),
    });
  }

  private async promptToDownload(): Promise<void> {
    if (!this.latestRelease) {
      return;
    }

    const parentWindow = this.options.getParentWindow();
    if (parentWindow) {
      const result = await dialog.showMessageBox(parentWindow, {
        type: "info",
        title: this.text("Update Available", "发现新版本"),
        message: this.text(
          `AgentFlow ${this.latestRelease.latestVersion} is available.`,
          `发现 AgentFlow ${this.latestRelease.latestVersion} 新版本。`,
        ),
        detail: this.latestRelease.notes || this.text(
          "A newer desktop build is ready to download.",
          "新的桌面端版本已经可以下载。",
        ),
        buttons: [
          this.text("Download", "下载"),
          this.text("Later", "稍后"),
        ],
        cancelId: 1,
        defaultId: 0,
        noLink: true,
      });
      if (result.response === 0) {
        await this.downloadAvailableUpdate();
      }
      return;
    }

    if (Notification.isSupported()) {
      new Notification({
        title: this.text("Update Available", "发现新版本"),
        body: this.text(
          `AgentFlow ${this.latestRelease.latestVersion} is ready to download.`,
          `AgentFlow ${this.latestRelease.latestVersion} 已可下载。`,
        ),
      }).show();
    }
  }

  private async promptToInstall(): Promise<void> {
    if (this.state.status !== "downloaded") {
      return;
    }

    if (this.options.getSilentInstallEnabled()) {
      if (this.options.canInstallNow()) {
        if (await this.tryInstallSilently()) {
          return;
        }
      } else {
        this.setState({
          message: this.text(
            "Update downloaded. Silent install will start after queued and running tasks finish.",
            "更新已下载，待运行中和排队任务完成后会自动静默安装。",
          ),
        });
      }
    }

    const parentWindow = this.options.getParentWindow();
    if (parentWindow) {
      const result = await dialog.showMessageBox(parentWindow, {
        type: "info",
        title: this.text("Update Ready", "更新已就绪"),
        message: this.text(
          `Version ${this.state.latestVersion} has finished downloading.`,
          `版本 ${this.state.latestVersion} 已下载完成。`,
        ),
        detail: this.text(
          "Open the installer now to complete the update.",
          "现在打开安装程序即可完成更新。",
        ),
        buttons: [
          this.text("Install Now", "立即安装"),
          this.text("Later", "稍后"),
        ],
        cancelId: 1,
        defaultId: 0,
        noLink: true,
      });
      if (result.response === 0) {
        await this.installDownloadedUpdate();
      }
      return;
    }

    if (Notification.isSupported()) {
      new Notification({
        title: this.text("Update Ready", "更新已就绪"),
        body: this.text(
          `AgentFlow ${this.state.latestVersion} is ready to install.`,
          `AgentFlow ${this.state.latestVersion} 已可安装。`,
        ),
      }).show();
    }
  }

  private normalizeBaseUrl(rawUrl: string): string | null {
    const trimmed = rawUrl.trim().replace(/\/+$/u, "");
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith("ws://")) {
      return `http://${trimmed.slice(5).replace(/\/ws$/u, "")}`;
    }
    if (trimmed.startsWith("wss://")) {
      return `https://${trimmed.slice(6).replace(/\/ws$/u, "")}`;
    }
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed.replace(/\/ws$/u, "");
    }
    return `http://${trimmed.replace(/\/ws$/u, "")}`;
  }

  private buildDownloadHeaders(downloadUrl: string): Record<string, string> {
    if (this.isGitHubDownloadUrl(downloadUrl)) {
      return {
        Accept: "application/octet-stream",
        "User-Agent": "AgentFlow-Desktop-Updater",
      };
    }
    return buildRelayApiHeaders();
  }

  private isGitHubDownloadUrl(downloadUrl: string): boolean {
    try {
      const host = new URL(downloadUrl).hostname.toLowerCase();
      return host === "github.com" || host.endsWith(".github.com") || host.endsWith(".githubusercontent.com");
    } catch {
      return false;
    }
  }

  private clearOldUpdatePackages(downloadDir: string): void {
    if (!fs.existsSync(downloadDir)) {
      return;
    }

    for (const entry of fs.readdirSync(downloadDir, { withFileTypes: true })) {
      const entryPath = path.join(downloadDir, entry.name);
      try {
        if (entry.isDirectory()) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(entryPath);
        }
      } catch {
        // Best-effort cleanup. A locked old installer should not block a new download.
      }
    }
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: app.getVersion(),
    };
    this.emit("state-changed", this.getState());
  }

  private text(en: string, zh: string): string {
    return getLang() === "zh" ? zh : en;
  }

  private formatError(error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error);
    return this.text(
      `Update failed: ${detail}`,
      `更新失败：${detail}`,
    );
  }

  private async tryInstallSilently(): Promise<boolean> {
    if (!this.options.getSilentInstallEnabled()) {
      return false;
    }
    if (this.silentInstallInFlight) {
      return true;
    }
    if (this.state.status !== "downloaded") {
      return false;
    }
    if (!this.options.canInstallNow()) {
      this.setState({
        message: this.text(
          "Update downloaded. Waiting for running and queued tasks to finish before silent install.",
          "更新已下载，等待运行中和排队任务结束后再静默安装。",
        ),
      });
      return false;
    }

    this.silentInstallInFlight = true;
    try {
      return await this.installDownloadedUpdateInternal(true);
    } finally {
      this.silentInstallInFlight = false;
    }
  }

  private scheduleRestartAfterSilentInstall(installerPid: number | null, expectedVersion: string): void {
    if (process.platform !== "win32") {
      return;
    }

    const targetPath = process.execPath;
    if (!targetPath) {
      return;
    }

    const parentPid = process.pid;
    const installerPidValue = Number.isFinite(installerPid) && installerPid && installerPid > 0
      ? installerPid
      : 0;
    const productName = app.getName();
    const normalizedExpectedVersion = expectedVersion.trim() || app.getVersion();
    const encodedCommand = Buffer.from(
      [
        `$parentPid = ${parentPid}`,
        `$installerPid = ${installerPidValue}`,
        `$targetPath = ${JSON.stringify(targetPath)}`,
        `$productName = ${JSON.stringify(productName)}`,
        `$expectedVersion = ${JSON.stringify(normalizedExpectedVersion)}`,
        `$waitSteps = ${UpdateManager.SILENT_RESTART_WAIT_STEPS}`,
        `$waitIntervalMs = ${UpdateManager.SILENT_RESTART_WAIT_INTERVAL_MS}`,
        `$launchRetrySteps = ${UpdateManager.SILENT_RESTART_LAUNCH_RETRY_STEPS}`,
        `$launchRetryIntervalMs = ${UpdateManager.SILENT_RESTART_LAUNCH_RETRY_INTERVAL_MS}`,
        `$processSettleMs = ${UpdateManager.SILENT_RESTART_PROCESS_SETTLE_MS}`,
        "$candidatePaths = New-Object System.Collections.Generic.List[string]",
        "if ($targetPath) { [void]$candidatePaths.Add($targetPath) }",
        "$localAppCandidate = Join-Path $env:LOCALAPPDATA ('Programs\\' + $productName + '\\' + [System.IO.Path]::GetFileName($targetPath))",
        "if ($localAppCandidate) { [void]$candidatePaths.Add($localAppCandidate) }",
        "$programFilesCandidate = Join-Path $env:ProgramFiles ($productName + '\\' + [System.IO.Path]::GetFileName($targetPath))",
        "if ($programFilesCandidate) { [void]$candidatePaths.Add($programFilesCandidate) }",
        "if ($env:'ProgramFiles(x86)') {",
        "  $programFilesX86Candidate = Join-Path $env:'ProgramFiles(x86)' ($productName + '\\' + [System.IO.Path]::GetFileName($targetPath))",
        "  if ($programFilesX86Candidate) { [void]$candidatePaths.Add($programFilesX86Candidate) }",
        "}",
        "$uninstallRoots = @(",
        "  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
        ")",
        "foreach ($root in $uninstallRoots) {",
        "  try {",
        "    $matches = Get-ItemProperty -Path $root -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $productName }",
        "    foreach ($match in $matches) {",
        "      if ($match.InstallLocation) {",
        "        $candidate = Join-Path $match.InstallLocation ([System.IO.Path]::GetFileName($targetPath))",
        "        if ($candidate) { [void]$candidatePaths.Add($candidate) }",
        "      }",
        "    }",
        "  } catch { }",
        "}",
        "function Get-NormalizedVersion($filePath) {",
        "  if (-not (Test-Path $filePath)) { return '' }",
        "  try {",
        "    $info = (Get-Item $filePath).VersionInfo",
        "    $version = $info.ProductVersion",
        "    if (-not $version) { $version = $info.FileVersion }",
        "    if (-not $version) { return '' }",
        "    $normalized = ($version -replace '[^0-9\\.]', '').Trim('.')",
        "    return $normalized",
        "  } catch {",
        "    return ''",
        "  }",
        "}",
        "function Test-VersionReady($filePath, $expectedVersion) {",
        "  if (-not (Test-Path $filePath)) { return $false }",
        "  if (-not $expectedVersion) { return $true }",
        "  $version = Get-NormalizedVersion $filePath",
        "  if (-not $version) { return $false }",
        "  return $version -eq $expectedVersion -or $version.StartsWith($expectedVersion + '.')",
        "}",
        "for ($i = 0; $i -lt $waitSteps; $i++) {",
        "  if (-not (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) { break }",
        "  Start-Sleep -Milliseconds $waitIntervalMs",
        "}",
        "if ($installerPid -gt 0) {",
        "  for ($i = 0; $i -lt $waitSteps; $i++) {",
        "    if (-not (Get-Process -Id $installerPid -ErrorAction SilentlyContinue)) { break }",
        "    Start-Sleep -Milliseconds $waitIntervalMs",
        "  }",
        "}",
        "Start-Sleep -Milliseconds $processSettleMs",
        "$launchPath = $null",
        "for ($i = 0; $i -lt $launchRetrySteps; $i++) {",
        "  $launchPath = $null",
        "  foreach ($candidatePath in $candidatePaths | Select-Object -Unique) {",
        "    if (Test-VersionReady $candidatePath $expectedVersion) {",
        "      $launchPath = $candidatePath",
        "      break",
        "    }",
        "  }",
        "  if (-not $launchPath) {",
        "    Start-Sleep -Milliseconds $launchRetryIntervalMs",
        "    continue",
        "  }",
        "  $launchDir = Split-Path -Parent $launchPath",
        "  try {",
        "    $existing = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $launchPath })",
        "    if ($existing.Count -gt 0) { break }",
        "  } catch { }",
        "  try {",
        "    Start-Process -FilePath $launchPath -WorkingDirectory $launchDir | Out-Null",
        "    Start-Sleep -Milliseconds 2000",
        "    $started = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $launchPath })",
        "    if ($started.Count -gt 0) { break }",
        "  } catch { }",
        "  Start-Sleep -Milliseconds $launchRetryIntervalMs",
        "}",
      ].join("\n"),
      "utf16le",
    ).toString("base64");

    const helper = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    helper.unref();
  }
}

export default UpdateManager;
