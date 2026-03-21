import { app, BrowserWindow, dialog, Notification, shell } from "electron";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

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
  getParentWindow: () => BrowserWindow | null;
}

class UpdateManager extends EventEmitter {
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
        message: "No update is ready to download.",
      });
      return this.getState();
    }

    this.setState({
      status: "downloading",
      latestVersion: this.latestRelease.latestVersion,
      notes: this.latestRelease.notes ?? "",
      mandatory: Boolean(this.latestRelease.mandatory),
      message: `Downloading ${this.latestRelease.latestVersion}...`,
    });

    try {
      const response = await fetch(this.latestRelease.downloadUrl);
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
      const targetName = this.latestRelease.filename?.trim() || `claude-code-agent-${this.latestRelease.latestVersion}.exe`;
      const targetPath = path.join(downloadDir, targetName);
      fs.writeFileSync(targetPath, buffer);

      this.setState({
        status: "downloaded",
        downloadedPath: targetPath,
        latestVersion: this.latestRelease.latestVersion,
        notes: this.latestRelease.notes ?? "",
        mandatory: Boolean(this.latestRelease.mandatory),
        message: `Version ${this.latestRelease.latestVersion} is ready to install.`,
      });
      await this.promptToInstall();
    } catch (error) {
      this.setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return this.getState();
  }

  async installDownloadedUpdate(): Promise<boolean> {
    const downloadedPath = this.state.downloadedPath;
    if (!downloadedPath || !fs.existsSync(downloadedPath)) {
      this.setState({
        status: "error",
        message: "No downloaded installer is available.",
      });
      return false;
    }

    const errorMessage = await shell.openPath(downloadedPath);
    if (errorMessage) {
      this.setState({
        status: "error",
        message: errorMessage,
      });
      return false;
    }

    this.setState({
      message: "Installer launched. Finish the setup to update this app.",
    });
    return true;
  }

  private async performCheck(manual: boolean): Promise<void> {
    const baseUrl = this.normalizeBaseUrl(this.options.getServerUrl());
    if (!baseUrl) {
      this.setState({
        status: "error",
        message: "Relay Server URL is not configured.",
      });
      return;
    }

    this.setState({
      status: "checking",
      message: manual ? "Checking for updates..." : null,
    });

    try {
      const query = new URLSearchParams({
        platform: process.platform === "win32" ? "desktop-win" : `desktop-${process.platform}`,
        channel: "stable",
        arch: process.arch,
        version: app.getVersion(),
        build: "0",
      });
      const response = await fetch(`${baseUrl}/api/update/check?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Update check failed with status ${response.status}`);
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
        this.latestRelease = null;
        this.setState({
          status: "up_to_date",
          latestVersion: null,
          notes: "",
          mandatory: false,
          downloadedPath: null,
          message: manual ? "You already have the latest version." : null,
          lastCheckedAt: Date.now(),
        });
        return;
      }

      this.latestRelease = {
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

      this.setState({
        status: "available",
        latestVersion: this.latestRelease.latestVersion,
        notes: this.latestRelease.notes ?? "",
        mandatory: Boolean(this.latestRelease.mandatory),
        downloadedPath: null,
        message: `Version ${this.latestRelease.latestVersion} is available.`,
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
        message: error instanceof Error ? error.message : String(error),
        lastCheckedAt: Date.now(),
      });
    }
  }

  private async promptToDownload(): Promise<void> {
    if (!this.latestRelease) {
      return;
    }

    const parentWindow = this.options.getParentWindow();
    if (parentWindow) {
      const result = await dialog.showMessageBox(parentWindow, {
        type: "info",
        title: "Update Available",
        message: `Claude Code Agent ${this.latestRelease.latestVersion} is available.`,
        detail: this.latestRelease.notes || "A newer desktop build is ready to download.",
        buttons: ["Download", "Later"],
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
        title: "Update Available",
        body: `Claude Code Agent ${this.latestRelease.latestVersion} is ready to download.`,
      }).show();
    }
  }

  private async promptToInstall(): Promise<void> {
    if (this.state.status !== "downloaded") {
      return;
    }

    const parentWindow = this.options.getParentWindow();
    if (parentWindow) {
      const result = await dialog.showMessageBox(parentWindow, {
        type: "info",
        title: "Update Ready",
        message: `Version ${this.state.latestVersion} has finished downloading.`,
        detail: "Open the installer now to complete the update.",
        buttons: ["Install Now", "Later"],
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
        title: "Update Ready",
        body: `Claude Code Agent ${this.state.latestVersion} is ready to install.`,
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

  private setState(patch: Partial<UpdateState>): void {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: app.getVersion(),
    };
    this.emit("state-changed", this.getState());
  }
}

export default UpdateManager;
