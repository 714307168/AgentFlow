import { app, BrowserWindow, dialog, Notification, shell } from "electron";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { getLang } from "./i18n";
import { buildRelayApiHeaders } from "./api-version";
import {
  buildLinuxDesktopPackageInstallPlan,
  buildLinuxDesktopPackageInstallCommand,
  isLinuxAppImage,
  isLinuxDesktopPackage,
} from "./update-package-install";
import {
  buildGitHubApiHeaders,
  buildGitHubUpdateCandidate,
  getGitHubReleaseApiUrl,
  type GitHubReleasePayload,
} from "./github-update-source";
import { selectFastestGitHubDownloadUrl } from "./github-download-accelerator";

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
  downloadProgress: {
    downloadedBytes: number;
    totalBytes: number | null;
    percent: number;
  } | null;
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
    downloadProgress: null,
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
      downloadedPath: null,
      downloadProgress: {
        downloadedBytes: 0,
        totalBytes: this.latestRelease.size ?? null,
        percent: 0,
      },
      message: null,
    });

    try {
      const originalDownloadUrl = this.latestRelease.downloadUrl;
      const selectedDownload = await selectFastestGitHubDownloadUrl(originalDownloadUrl);
      const response = await fetch(selectedDownload.url, {
        headers: this.buildDownloadHeaders(originalDownloadUrl),
      });
      if (!response.ok) {
        throw new Error(`Download failed from ${selectedDownload.label} with status ${response.status}`);
      }

      const buffer = await this.readDownloadBuffer(response, this.latestRelease.size ?? null);
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
      if (isLinuxAppImage(targetPath)) {
        fs.chmodSync(targetPath, 0o755);
      }

      this.setState({
        status: "downloaded",
        downloadedPath: targetPath,
        latestVersion: this.latestRelease.latestVersion,
        notes: this.latestRelease.notes ?? "",
        mandatory: Boolean(this.latestRelease.mandatory),
        downloadProgress: {
          downloadedBytes: buffer.length,
          totalBytes: buffer.length,
          percent: 100,
        },
        message: null,
      });
      if (!(await this.tryInstallSilently())) {
        await this.promptToInstall();
      }
    } catch (error) {
      this.setState({
        status: "error",
        downloadProgress: null,
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

    if (isLinuxDesktopPackage(downloadedPath)) {
      if (this.launchLinuxDesktopPackageInstaller(downloadedPath)) {
        return true;
      }
      shell.showItemInFolder(downloadedPath);
      const installCommand = buildLinuxDesktopPackageInstallCommand(downloadedPath);
      this.setState({
        message: this.text(
          `Update package downloaded. Open a terminal and run: ${installCommand}`,
          `更新包已下载。请在终端执行：${installCommand}`,
        ),
      });
      return true;
    }

    let errorMessage = "";
    try {
      errorMessage = await shell.openPath(downloadedPath);
    } catch (error) {
      errorMessage = this.formatError(error);
    }
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

  private launchLinuxDesktopPackageInstaller(downloadedPath: string): boolean {
    const plan = buildLinuxDesktopPackageInstallPlan(downloadedPath);
    if (!plan || !this.canUsePkexec()) {
      return false;
    }

    try {
      const child = spawn(plan.command, plan.args, {
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", (error) => {
        this.setState({
          message: this.text(
            `Update package downloaded, but the system installer could not be started. Open a terminal and run: ${buildLinuxDesktopPackageInstallCommand(downloadedPath)}. Error: ${error.message}`,
            `更新包已下载，但无法启动系统安装器。请在终端执行：${buildLinuxDesktopPackageInstallCommand(downloadedPath)}。错误：${error.message}`,
          ),
        });
      });
      child.on("close", (code) => {
        if (code === 0) {
          this.setState({
            message: this.text(
              "Update installed. AgentFlow is restarting.",
              "更新已安装，AgentFlow 正在重启。",
            ),
          });
          setTimeout(() => {
            app.relaunch();
            app.exit(0);
          }, 500);
          return;
        }

        this.setState({
          message: this.text(
            `Update package installer exited with code ${code ?? "unknown"}. Open a terminal and run: ${buildLinuxDesktopPackageInstallCommand(downloadedPath)}`,
            `更新包安装器退出，状态码：${code ?? "unknown"}。请在终端执行：${buildLinuxDesktopPackageInstallCommand(downloadedPath)}`,
          ),
        });
      });
      this.setState({
        message: this.text(
          `System installer started. Authorize the prompt to install the update: ${plan.commandPreview}`,
          `系统安装器已启动。请在授权提示中确认安装更新：${plan.commandPreview}`,
        ),
      });
      return true;
    } catch (error) {
      this.setState({
        message: this.text(
          `Update package downloaded, but the system installer could not be started. Open a terminal and run: ${buildLinuxDesktopPackageInstallCommand(downloadedPath)}. Error: ${this.formatError(error)}`,
          `更新包已下载，但无法启动系统安装器。请在终端执行：${buildLinuxDesktopPackageInstallCommand(downloadedPath)}。错误：${this.formatError(error)}`,
        ),
      });
      return false;
    }
  }

  private canUsePkexec(): boolean {
    return process.platform === "linux"
      && (fs.existsSync("/usr/bin/pkexec") || fs.existsSync("/bin/pkexec"));
  }

  private async performCheck(manual: boolean): Promise<void> {
    this.setState({
      status: "checking",
      downloadProgress: null,
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
        downloadProgress: null,
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
      downloadProgress: null,
      message: null,
      lastCheckedAt: Date.now(),
    });
  }

  private async readDownloadBuffer(response: Response, expectedSize: number | null): Promise<Buffer> {
    const contentLength = Number(response.headers.get("content-length") ?? "");
    const totalBytes = Number.isFinite(contentLength) && contentLength > 0
      ? contentLength
      : (expectedSize && expectedSize > 0 ? expectedSize : null);

    if (!response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      this.setDownloadProgress(buffer.length, buffer.length, true);
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let downloadedBytes = 0;
    let lastEmittedAt = 0;
    let lastEmittedPercent = -1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      downloadedBytes += chunk.length;
      const percent = totalBytes ? Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100)) : 0;
      const now = Date.now();
      if (now - lastEmittedAt >= 250 || percent !== lastEmittedPercent) {
        this.setDownloadProgress(downloadedBytes, totalBytes, false);
        lastEmittedAt = now;
        lastEmittedPercent = percent;
      }
    }

    const buffer = Buffer.concat(chunks);
    this.setDownloadProgress(buffer.length, totalBytes ?? buffer.length, true);
    return buffer;
  }

  private setDownloadProgress(downloadedBytes: number, totalBytes: number | null, complete: boolean): void {
    const normalizedTotal = totalBytes && totalBytes > 0 ? totalBytes : null;
    const percent = complete
      ? 100
      : (normalizedTotal ? Math.min(99, Math.max(0, Math.floor((downloadedBytes / normalizedTotal) * 100))) : 0);
    this.setState({
      downloadProgress: {
        downloadedBytes: Math.max(0, downloadedBytes),
        totalBytes: normalizedTotal,
        percent,
      },
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
    if (process.platform !== "win32") {
      return false;
    }
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
