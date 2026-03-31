import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, safeStorage, clipboard, desktopCapturer, screen, shell } from "electron";
import "./user-data-bootstrap";
import * as fs from "fs";
import * as path from "path";
import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";
import { createAppIcon, createTrayIcon } from "./app-icon";
import appLogger from "./app-logger";
import RelayClient from "./relay-client";
import MessageRouter from "./message-router";
import projectStore, { normalizeProjectGroupName, Project } from "./project-store";
import ptyManager from "./pty-manager";
import RemoteSessionStore, { RemoteProjectRecord } from "./remote-session-store";
import RemoteWorkgroupStore, { RemoteWorkgroupRegistryRecord, parseCompositeWorkgroupId } from "./remote-workgroup-store";
import RuntimeManager, { CliProvider, ProjectSessionSnapshot, RunAttachment } from "./runtime-manager";
import workgroupStore, { Workgroup, WorkgroupMember, WorkgroupRole, WorkgroupTask, WorkgroupTaskStatus } from "./workgroup-store";
import WorkgroupCollaborationService, {
  CollaborationBoundProject,
  WorkgroupCollaborationSessionSnapshot,
  WorkgroupCollaborationSummary,
} from "./workgroup-collaboration-service";
import { buildSessionSyncPayload } from "./session-sync-payload";
import {
  createSessionSyncContentMd5,
  type SessionSyncKnownItemDigest,
} from "./session-sync-hash";
import UpdateManager, { UpdateState } from "./update-manager";
import { Events } from "./types";
import { t, getLang, setLang, getAllMessages, Lang } from "./i18n";
import {
  buildImagePreviewDataUrlFromNativeImage,
  createRunAttachmentFromPath,
  getUniqueAttachmentPath,
  isImageAttachment,
} from "./attachment-utils";
import {
  getDefaultLocalDataRoot,
  getPersistedLocalDataRoot,
  localDataRootsEqual,
  migrateLocalDataRoot,
  persistLocalDataRoot,
  resolveLocalDataRoot,
} from "./user-data-bootstrap";

interface AgentConfig {
  serverUrl: string;
  agentId: string;
  token: string;
  username?: string;
  password?: string;
  tokenExpiresAt?: string;
  controllerDeviceId?: string;
  controllerToken?: string;
  controllerTokenExpiresAt?: string;
  encryptedToken?: string;
  encryptedPassword?: string;
  encryptedControllerToken?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiDefaultModel?: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  anthropicDefaultModel?: string;
  encryptedOpenaiApiKey?: string;
  encryptedAnthropicApiKey?: string;
  cliProvider: CliProvider;
}

interface AppSettings {
  autoStart: boolean;
  silentLaunch: boolean;
  completionSound: boolean;
  saveLogs: boolean;
  e2eEnabled: boolean;
  autoUpdateCheck: boolean;
  autoUpdateDownload: boolean;
  silentUpdateInstall: boolean;
  historyRetentionDays: number;
  localDataRoot: string;
}

type SettingsPane = "connection" | "project" | "system";

interface PersistedWindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

interface WindowStateSchema {
  settingsWindow: PersistedWindowState;
  workspaceWindow: PersistedWindowState;
}

interface ResolvedWorkgroupProjectBinding {
  projectId: string | null;
  projectName: string | null;
  projectPath: string | null;
  projectKind: "local" | "remote" | null;
  projectExists: boolean;
  projectOnline: boolean;
}

interface WorkgroupMemberView extends Omit<WorkgroupMember, "projectId" | "projectName" | "projectPath" | "projectKind">, ResolvedWorkgroupProjectBinding {
  projectBindingLabel: string;
}

interface WorkgroupTaskView extends WorkgroupTask {
  assigneeMemberName: string | null;
  assigneeRole: WorkgroupRole | null;
  assigneeProjectName: string | null;
  assigneeProjectKind: "local" | "remote" | null;
  assigneeProjectOnline: boolean;
  assigneeProjectBindingLabel: string | null;
  dispatchReady: boolean;
  dispatchBlockedReason: string | null;
}

interface WorkgroupView extends Workgroup {
  members: WorkgroupMemberView[];
  tasks: WorkgroupTaskView[];
  selectedProjectIds: string[];
}

interface WorkgroupRegistryRecord {
  groupNumber: string;
  workgroupId: string;
  hostAgentId: string;
  name: string;
  description: string | null;
  ownerUsername: string;
  memberCount?: number;
  canManage?: boolean;
  joined?: boolean;
  updatedAt: number;
}

const WORKGROUP_PM_PROJECT_PREFIX = "__workgroup_pm__:";

const configStore = new Store<AgentConfig>({
  defaults: {
    serverUrl: "ws://localhost:8080/ws",
    agentId: "",
    token: "",
    username: "",
    tokenExpiresAt: "",
    controllerDeviceId: "",
    controllerToken: "",
    controllerTokenExpiresAt: "",
    encryptedToken: "",
    encryptedPassword: "",
    encryptedControllerToken: "",
    openaiApiKey: "",
    openaiBaseUrl: "",
    openaiDefaultModel: "",
    anthropicApiKey: "",
    anthropicBaseUrl: "",
    anthropicDefaultModel: "",
    encryptedOpenaiApiKey: "",
    encryptedAnthropicApiKey: "",
    cliProvider: "claude",
  },
});

const appSettingsStore = new Store<AppSettings>({
  name: "app-settings",
  defaults: {
    autoStart: false,
    silentLaunch: false,
    completionSound: true,
    saveLogs: false,
    e2eEnabled: true,
    autoUpdateCheck: true,
    autoUpdateDownload: false,
    silentUpdateInstall: false,
    historyRetentionDays: 30,
    localDataRoot: "",
  },
});

const windowStateStore = new Store<WindowStateSchema>({
  name: "window-state",
  defaults: {
    settingsWindow: {
      width: 800,
      height: 700,
      maximized: false,
    },
    workspaceWindow: {
      width: 1000,
      height: 700,
      maximized: false,
    },
  },
});

appLogger.setEnabled(appSettingsStore.get("saveLogs") as boolean);
appLogger.installConsoleCapture();

function syncLocalDataRootSetting(nextRoot: string = app.getPath("userData")): void {
  const normalizedRoot = String(nextRoot ?? "").trim();
  if ((appSettingsStore.get("localDataRoot") as string | undefined) !== normalizedRoot) {
    appSettingsStore.set("localDataRoot", normalizedRoot);
  }
}

syncLocalDataRootSetting();

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let workspaceWindow: BrowserWindow | null = null;
let activeWorkspaceProjectId: string | null = null;
let activeSettingsPane: SettingsPane = "system";
let relayClient: RelayClient | null = null;
let controllerRelayClient: RelayClient | null = null;
let remoteSessionStore: RemoteSessionStore | null = null;
let remoteWorkgroupStore: RemoteWorkgroupStore | null = null;
const lastBroadcastSyncSeqByProject = new Map<string, number>();
const updateManager = new UpdateManager({
  getServerUrl: () => loadConfig().serverUrl,
  getAutoCheckEnabled: () => appSettingsStore.get("autoUpdateCheck") as boolean,
  getAutoDownloadEnabled: () => appSettingsStore.get("autoUpdateDownload") as boolean,
  getSilentInstallEnabled: () => appSettingsStore.get("silentUpdateInstall") as boolean,
  canInstallNow: () => !runtimeManager.hasActiveOrQueuedRuns(),
  prepareForSilentInstall: async () => {
    if (relayClient) {
      relayClient.disconnect();
    }
    if (workspaceWindow && !workspaceWindow.isDestroyed()) {
      workspaceWindow.hide();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  },
  getParentWindow: () => workspaceWindow ?? mainWindow ?? null,
});
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000;
const MIN_TOKEN_REFRESH_DELAY_MS = 30 * 1000;
const MAX_TIMEOUT_DELAY_MS = 2_147_483_647;
let tokenRefreshTimer: NodeJS.Timeout | null = null;
let tokenRefreshPromise: Promise<boolean> | null = null;
let controllerTokenRefreshTimer: NodeJS.Timeout | null = null;
let controllerTokenRefreshPromise: Promise<boolean> | null = null;
const relaySyncTimersByProject = new Map<string, NodeJS.Timeout>();
const pendingRelaySyncSnapshotsByProject = new Map<string, ProjectSessionSnapshot>();
const lastBroadcastSyncPayloadHashByProject = new Map<string, string>();
const RELAY_SYNC_DEBOUNCE_MS = 250;
let lastWorkgroupRelayPayloadHash = "";
const workgroupCollaborationRelaySnapshotTimers = new Map<string, NodeJS.Timeout>();
const pendingWorkgroupCollaborationRelaySnapshots = new Map<string, WorkgroupCollaborationSessionSnapshot>();
const lastBroadcastWorkgroupCollaborationSnapshotHashByWorkgroup = new Map<string, string>();
const WORKGROUP_COLLABORATION_RELAY_DEBOUNCE_MS = 200;
let lastWorkgroupCollaborationRelayPayloadHash = "";
const REMOTE_PROJECT_CATALOG_REFRESH_MIN_INTERVAL_MS = 5_000;
const REMOTE_WORKGROUP_CATALOG_REFRESH_MIN_INTERVAL_MS = 15_000;
let lastRemoteProjectCatalogRefreshAt = 0;
let remoteProjectCatalogRefreshTimer: NodeJS.Timeout | null = null;
let lastRemoteWorkgroupCatalogRefreshAt = 0;

function clampTimeoutDelayMs(delayMs: number): number {
  if (!Number.isFinite(delayMs)) {
    return MIN_TOKEN_REFRESH_DELAY_MS;
  }
  return Math.min(Math.max(MIN_TOKEN_REFRESH_DELAY_MS, Math.trunc(delayMs)), MAX_TIMEOUT_DELAY_MS);
}

function normalizeIncomingAttachments(payload: unknown): RunAttachment[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((entry): entry is Partial<RunAttachment> => Boolean(entry) && typeof entry === "object")
    .map((entry) => {
      const filePath = typeof entry.path === "string" ? path.resolve(entry.path) : "";
      if (!filePath || !fs.existsSync(filePath)) {
        return null;
      }
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return null;
      }

      return createRunAttachmentFromPath(filePath, {
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : uuidv4(),
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : path.basename(filePath),
        size: Number.isFinite(entry.size) ? Math.max(0, Number(entry.size)) : stats.size,
        kind: entry.kind === "image" || isImageAttachment(filePath) ? "image" : "file",
        mimeType: typeof entry.mimeType === "string" ? entry.mimeType : undefined,
        previewDataUrl: typeof entry.previewDataUrl === "string" ? entry.previewDataUrl : undefined,
      });
    })
    .filter((entry): entry is RunAttachment => entry !== null);
}

function encodeSecretForStore(secret: string): string {
  if (!secret) {
    return "";
  }

  if (safeStorage.isEncryptionAvailable()) {
    return `enc:${safeStorage.encryptString(secret).toString("base64")}`;
  }

  return `plain:${Buffer.from(secret, "utf8").toString("base64")}`;
}

function decodeSecretFromStore(storedValue?: string): string {
  if (!storedValue) {
    return "";
  }

  if (storedValue.startsWith("enc:")) {
    if (!safeStorage.isEncryptionAvailable()) {
      return "";
    }

    try {
      return safeStorage.decryptString(Buffer.from(storedValue.slice(4), "base64"));
    } catch (_error) {
      return "";
    }
  }

  if (storedValue.startsWith("plain:")) {
    try {
      return Buffer.from(storedValue.slice(6), "base64").toString("utf8");
    } catch (_error) {
      return "";
    }
  }

  return storedValue;
}

function toHttpBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "http://localhost:8080";
  }

  if (trimmed.startsWith("ws://")) {
    return `http://${trimmed.slice(5).replace(/\/ws$/, "")}`;
  }
  if (trimmed.startsWith("wss://")) {
    return `https://${trimmed.slice(6).replace(/\/ws$/, "")}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/\/ws$/, "");
  }

  return `http://${trimmed.replace(/\/ws$/, "")}`;
}

function isTokenExpiringSoon(expiresAt?: string, nowMs: number = Date.now()): boolean {
  if (!expiresAt) {
    return true;
  }

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return true;
  }

  return expiresAtMs - nowMs <= TOKEN_REFRESH_WINDOW_MS;
}

function getDefaultCliProvider(): CliProvider {
  return loadConfig().cliProvider === "codex" ? "codex" : "claude";
}

function normalizeCliProvider(
  provider: string | null | undefined,
  fallback: CliProvider = "claude",
): CliProvider {
  if (provider === "claude" || provider === "codex") {
    return provider;
  }
  return fallback;
}

function getProjectCliProvider(projectId: string): CliProvider {
  const project = projectStore.getById(projectId);
  return normalizeCliProvider(project?.cliProvider, getDefaultCliProvider());
}

function getProjectCliModel(projectId: string): string | null {
  const project = projectStore.getById(projectId);
  const model = project?.cliModel?.trim() ?? "";
  if (model) {
    return model;
  }

  const config = loadConfig();
  if (getProjectCliProvider(projectId) === "codex") {
    const defaultModel = config.openaiDefaultModel?.trim() ?? "";
    return defaultModel || null;
  }

  const defaultModel = config.anthropicDefaultModel?.trim() ?? "";
  return defaultModel || null;
}

function getProjectPrompt(projectId: string): string | null {
  if (isWorkgroupPmProjectId(projectId)) {
    const workgroupId = getWorkgroupIdFromPmProjectId(projectId);
    if (!workgroupId) {
      return null;
    }
    const workgroup = workgroupStore.getWorkgroupById(workgroupId);
    const planWorkspacePath = ensureWorkgroupPlanDirectory(
      workgroup?.planWorkspacePath ?? getDefaultWorkgroupPlanPath(workgroupId),
    );
    const memberNames = workgroupStore
      .listMembers(workgroupId)
      .filter((member) => member.kind !== "pm")
      .map((member) => member.name)
      .join(", ");
    return [
      `This is the planning workspace for workgroup ${workgroup?.name || workgroupId}.`,
      "Act as the PM Agent.",
      "Break the goal into concrete subtasks, track owner handoffs, summarize blockers, and write plans in this workspace when useful.",
      `Planning workspace: ${planWorkspacePath || "unknown"}`,
      `Members: ${memberNames || "none yet"}`,
    ].join("\n");
  }
  const project = projectStore.getById(projectId);
  const prompt = project?.projectPrompt?.trim() ?? "";
  return prompt || null;
}

function buildProjectListPayload(agentId: string): {
  agent_id: string;
  projects: Array<{
    id: string;
    name: string;
    path: string;
    group_name: string;
    cli_provider: CliProvider;
    cli_model: string;
    project_prompt: string;
  }>;
} {
  return {
    agent_id: agentId,
    projects: projectStore.getAll().map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      group_name: project.groupName ?? "",
      cli_provider: project.cliProvider,
      cli_model: project.cliModel ?? "",
      project_prompt: project.projectPrompt ?? "",
    })),
  };
}

normalizeAllWorkgroupPmMembers();

const runtimeManager = new RuntimeManager(() => ({
  getProjectProvider: getProjectCliProvider,
  getProjectModel: getProjectCliModel,
  getProjectPrompt,
  getProviderEnvironment: (provider) => getProviderEnvironment(provider),
  updateProject: (projectId, updates) => {
    projectStore.update(projectId, updates);
  },
  onProjectConfigChanged: (projectId) => {
    const project = projectStore.getById(projectId);
    if (project) {
      syncProjectCatalog(project.agentId || loadConfig().agentId);
    }
    rebuildTrayMenu();
    broadcastProjectsChanged();
    broadcastProjectSnapshot(projectId);
    updateWindowTitles();
  },
  captureProjectScreenshot: async (projectId) => captureProjectScreenshot(projectId),
}));
runtimeManager.pruneHistoryCache(appSettingsStore.get("historyRetentionDays") as number);
const workgroupCollaborationService = new WorkgroupCollaborationService({
  runtimeManager,
  getBoundProject: (projectId: string): CollaborationBoundProject | null => {
    if (isWorkgroupPmProjectId(projectId)) {
      const workgroupId = getWorkgroupIdFromPmProjectId(projectId);
      if (!workgroupId) {
        return null;
      }
      const binding = getWorkgroupPmBinding(workgroupId);
      return {
        id: binding.projectId ?? projectId,
        name: binding.projectName ?? "PM Agent",
        path: binding.projectPath ?? getDefaultWorkgroupPlanPath(workgroupId),
        kind: "local",
        online: true,
      };
    }
    const project = getProjectById(projectId);
    if (!project) {
      return null;
    }
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      kind: isRemoteProjectRecord(project) ? "remote" : "local",
      online: isRemoteProjectRecord(project) ? Boolean(project.online) : true,
    };
  },
  getProjectSessionSnapshot: (projectId: string) => getProjectSnapshot(projectId),
  getRemoteSessionStore: () => remoteSessionStore,
});

async function captureProjectScreenshot(projectId: string): Promise<RunAttachment> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.max(1, primaryDisplay.size.width),
      height: Math.max(1, primaryDisplay.size.height),
    },
    fetchWindowIcons: false,
  });

  const preferredSource = sources.find((source) => String(source.display_id || "") === String(primaryDisplay.id))
    ?? sources.find((source) => !source.thumbnail.isEmpty());
  if (!preferredSource || preferredSource.thumbnail.isEmpty()) {
    throw new Error("No display capture source is available.");
  }

  const screenshotFileName = `screenshot-${Date.now()}.png`;
  const targetPath = getUniqueAttachmentPath(projectId, screenshotFileName);
  fs.writeFileSync(targetPath, preferredSource.thumbnail.toPNG());

  return createRunAttachmentFromPath(targetPath, {
    name: screenshotFileName,
    kind: "image",
    previewDataUrl: buildImagePreviewDataUrlFromNativeImage(preferredSource.thumbnail, {
      maxDimension: 960,
      maxDataUrlChars: 180_000,
      format: "jpeg",
      jpegQuality: 78,
    }),
  });
}

function normalizeSettingsPane(pane?: string | null): SettingsPane {
  if (pane === "connection" || pane === "project" || pane === "system") {
    return pane;
  }
  return "system";
}

function getSettingsPaneTitle(pane: SettingsPane): string {
  if (getLang() === "zh") {
    switch (pane) {
      case "connection":
        return "服务器连接";
      case "project":
        return "项目设置";
      default:
        return "系统设置";
    }
  }

  switch (pane) {
    case "connection":
      return "Server Connection";
    case "project":
      return "Project Settings";
    default:
      return "System Settings";
  }
}

function broadcastSettingsPane(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("settings-pane-changed", activeSettingsPane);
  }
}

function getSettingsWindowTitle(pane: SettingsPane = activeSettingsPane): string {
  return `${getSettingsPaneTitle(pane)} - ${t("app.name")}`;
}

function getWorkspaceWindowTitle(projectId?: string | null): string {
  if (!projectId) {
    return t("app.name");
  }

  const project = getProjectById(projectId);
  return project ? `${project.name} - ${t("app.name")}` : t("app.name");
}

function getLangPayload(): { lang: Lang; messages: Record<string, string> } {
  return {
    lang: getLang(),
    messages: getAllMessages(),
  };
}

function getWindowState(storeKey: keyof WindowStateSchema): PersistedWindowState {
  const fallback = windowStateStore.get(storeKey) as PersistedWindowState | undefined;
  return {
    width: Math.max(640, Number(fallback?.width) || (storeKey === "settingsWindow" ? 800 : 1000)),
    height: Math.max(520, Number(fallback?.height) || 700),
    maximized: Boolean(fallback?.maximized),
    x: Number.isFinite(fallback?.x) ? Number(fallback?.x) : undefined,
    y: Number.isFinite(fallback?.y) ? Number(fallback?.y) : undefined,
  };
}

function isWindowBoundsVisible(state: PersistedWindowState): boolean {
  if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) {
    return false;
  }

  const bounds = {
    x: Number(state.x),
    y: Number(state.y),
    width: Math.max(1, Number(state.width) || 1),
    height: Math.max(1, Number(state.height) || 1),
  };

  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return bounds.x < area.x + area.width
      && bounds.x + bounds.width > area.x
      && bounds.y < area.y + area.height
      && bounds.y + bounds.height > area.y;
  });
}

function buildWindowOptions(
  storeKey: keyof WindowStateSchema,
  baseOptions: Electron.BrowserWindowConstructorOptions,
): Electron.BrowserWindowConstructorOptions {
  const state = getWindowState(storeKey);
  const options: Electron.BrowserWindowConstructorOptions = {
    ...baseOptions,
    width: state.width,
    height: state.height,
  };

  if (isWindowBoundsVisible(state)) {
    options.x = Number(state.x);
    options.y = Number(state.y);
  }

  return options;
}

function persistWindowState(
  storeKey: keyof WindowStateSchema,
  win: BrowserWindow,
): void {
  if (win.isDestroyed()) {
    return;
  }

  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  windowStateStore.set(storeKey, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: win.isMaximized(),
  });
}

function bindWindowStatePersistence(
  storeKey: keyof WindowStateSchema,
  win: BrowserWindow,
): void {
  let persistTimer: NodeJS.Timeout | null = null;

  const schedulePersist = (): void => {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistWindowState(storeKey, win);
    }, 180);
  };

  win.on("resize", schedulePersist);
  win.on("move", schedulePersist);
  win.on("maximize", () => persistWindowState(storeKey, win));
  win.on("unmaximize", schedulePersist);
  win.on("close", () => persistWindowState(storeKey, win));
  win.on("closed", () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  });
}

function updateTrayTooltip(): void {
  if (!tray) {
    return;
  }

  const tooltip = relayClient?.isConnected() ? t("tray.connected") : t("tray.disconnected");
  tray.setToolTip(tooltip);
}

function updateWindowTitles(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(getSettingsWindowTitle(activeSettingsPane));
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.setTitle(getWorkspaceWindowTitle(activeWorkspaceProjectId));
  }
}

function broadcastLangChange(): void {
  const payload = getLangPayload();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("lang-changed", payload);
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("lang-changed", payload);
  }
}

function broadcastUpdateState(state: UpdateState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-state-changed", state);
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("update-state-changed", state);
  }
}

function playCompletionSound(): void {
  if (!(appSettingsStore.get("completionSound") as boolean)) {
    return;
  }

  try {
    shell.beep();
  } catch (error) {
    appLogger.warn("runtime", "Failed to play completion sound.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

runtimeManager.on("snapshot", (projectId: string, snapshot: ProjectSessionSnapshot) => {
  syncWorkgroupTasksForProjectSnapshot(snapshot);
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("project-session-snapshot", snapshot);
  }
  broadcastSessionSync(snapshot);
  void updateManager.maybeInstallDownloadedUpdate();
});

runtimeManager.on("run-completed", () => {
  playCompletionSound();
});

updateManager.on("state-changed", (state: UpdateState) => {
  broadcastUpdateState(state);
});

workgroupCollaborationService.on("summaries", (summaries: WorkgroupCollaborationSummary[]) => {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("workgroup-collaboration-summaries", summaries);
  }
  broadcastWorkgroupCollaborationRelaySummaries();
});

workgroupCollaborationService.on("snapshot", (workgroupId: string, snapshot: WorkgroupCollaborationSessionSnapshot) => {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("workgroup-collaboration-snapshot", snapshot);
  }
  broadcastWorkgroupCollaborationRelaySnapshot(workgroupId, snapshot);
});

function broadcastProjectsChanged(): void {
  const projects = getAllProjects();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("projects-changed", projects);
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("projects-changed", projects);
  }

  broadcastWorkgroupsChanged();
  broadcastWorkgroupCollaborationSummaries();
}

function broadcastProjectSnapshot(projectId: string): void {
  const snapshot = getProjectSnapshot(projectId);
  if (!snapshot) {
    return;
  }
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("project-session-snapshot", snapshot);
  }
}

function getAllProjects(): Array<Project | RemoteProjectRecord> {
  const localProjects = projectStore.getAll();
  const remoteProjects = remoteSessionStore?.getProjects() ?? [];
  return [...localProjects, ...remoteProjects];
}

function getProjectById(projectId: string): (Project & { isRemote?: false }) | RemoteProjectRecord | undefined {
  return getAllProjects().find((project) => project.id === projectId);
}

function isRemoteProject(projectId: string): boolean {
  return remoteSessionStore?.hasProject(projectId) ?? false;
}

function getProjectSnapshot(projectId: string): ProjectSessionSnapshot | null {
  if (isRemoteProject(projectId)) {
    return remoteSessionStore?.getSnapshot(projectId) ?? null;
  }
  return runtimeManager.getSnapshot(projectId);
}

function getAllWorkgroupCollaborationSummaries(): WorkgroupCollaborationSummary[] {
  return [
    ...workgroupCollaborationService.listSummaries(),
    ...(remoteWorkgroupStore?.listSummaries() ?? []),
  ].sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, "zh-CN"));
}

function broadcastWorkgroupCollaborationSummaries(): void {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send(
      "workgroup-collaboration-summaries",
      getAllWorkgroupCollaborationSummaries(),
    );
  }
  broadcastWorkgroupCollaborationRelaySummaries();
}

function broadcastWorkgroupCollaborationSnapshot(workgroupId: string): void {
  const snapshot = workgroupCollaborationService.getSession(workgroupId);
  if (!snapshot) {
    return;
  }
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("workgroup-collaboration-snapshot", snapshot);
  }
  broadcastWorkgroupCollaborationRelaySnapshot(workgroupId, snapshot);
}

function buildWorkgroupCollaborationRelayPayload(): { agent_id: string; workgroups: WorkgroupCollaborationSummary[] } | null {
  const agentId = loadConfig().agentId.trim();
  if (!agentId) {
    return null;
  }
  return {
    agent_id: agentId,
    workgroups: workgroupCollaborationService.listSummaries(),
  };
}

function buildWorkgroupCollaborationSessionRelayPayload(data: {
  workgroupId: string;
  beforeId?: string | null;
  limit?: number;
  knownItems?: SessionSyncKnownItemDigest[];
}): {
  agent_id: string;
  workgroup_id: string;
  session: WorkgroupCollaborationSessionSnapshot & {
    messages: Array<WorkgroupCollaborationSessionSnapshot["messages"][number] & {
      content_md5: string;
      content_omitted?: boolean;
    }>;
  };
  page: {
    items: Array<WorkgroupCollaborationSessionSnapshot["messages"][number] & {
      content_md5: string;
      content_omitted?: boolean;
    }>;
    hasMore: boolean;
    total: number;
  };
} | null {
  const agentId = loadConfig().agentId.trim();
  if (!agentId) {
    return null;
  }

  const session = workgroupCollaborationService.getSession(data.workgroupId);
  if (!session) {
    return null;
  }

  const page = workgroupCollaborationService.getHistoryPage(data.workgroupId, {
    beforeId: data.beforeId,
    limit: data.limit,
  });
  if (!page) {
    return null;
  }

  const knownMap = new Map<string, string>();
  for (const item of data.knownItems ?? []) {
    const id = String(item?.id ?? "").trim();
    const contentMd5 = typeof item?.content_md5 === "string" ? item.content_md5.trim() : "";
    if (id && contentMd5) {
      knownMap.set(id, contentMd5);
    }
  }

  const normalizeMessages = <T extends WorkgroupCollaborationSessionSnapshot["messages"][number]>(messages: T[]) => {
    return messages.map((message) => {
      const contentMd5 = createSessionSyncContentMd5(message.content);
      const shouldOmitContent = knownMap.get(message.id) === contentMd5;
      return {
        ...message,
        content: shouldOmitContent ? "" : message.content,
        content_md5: contentMd5,
        content_omitted: shouldOmitContent || undefined,
      };
    });
  };

  return {
    agent_id: agentId,
    workgroup_id: data.workgroupId,
    session: {
      ...session,
      messages: normalizeMessages(session.messages),
    },
    page: {
      ...page,
      items: normalizeMessages(page.items),
    },
  };
}

function broadcastWorkgroupCollaborationRelaySummaries(): void {
  if (!relayClient || !relayClient.isConnected()) {
    return;
  }

  const payload = buildWorkgroupCollaborationRelayPayload();
  if (!payload) {
    return;
  }

  const payloadHash = JSON.stringify(payload);
  if (payloadHash === lastWorkgroupCollaborationRelayPayloadHash) {
    return;
  }
    lastWorkgroupCollaborationRelayPayloadHash = payloadHash;
    relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_COLLABORATION_LIST,
      agent_id: payload.agent_id,
      ts: Date.now(),
      payload,
    });
}

function broadcastWorkgroupCollaborationRelaySnapshot(
  workgroupId: string,
  snapshot?: WorkgroupCollaborationSessionSnapshot,
): void {
  if (!relayClient || !relayClient.isConnected()) {
    return;
  }

  const resolvedSnapshot = snapshot ?? workgroupCollaborationService.getSession(workgroupId);
  if (!resolvedSnapshot) {
    return;
  }

  pendingWorkgroupCollaborationRelaySnapshots.set(workgroupId, resolvedSnapshot);
  const existingTimer = workgroupCollaborationRelaySnapshotTimers.get(workgroupId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  workgroupCollaborationRelaySnapshotTimers.set(workgroupId, setTimeout(() => {
    workgroupCollaborationRelaySnapshotTimers.delete(workgroupId);
    const latestSnapshot = pendingWorkgroupCollaborationRelaySnapshots.get(workgroupId);
    if (!latestSnapshot || !relayClient || !relayClient.isConnected()) {
      return;
    }

    const agentId = loadConfig().agentId.trim();
    if (!agentId) {
      return;
    }

    const payload = {
      agent_id: agentId,
      workgroup_id: workgroupId,
      session: latestSnapshot,
    };
    const payloadHash = JSON.stringify(payload);
    if (lastBroadcastWorkgroupCollaborationSnapshotHashByWorkgroup.get(workgroupId) === payloadHash) {
      return;
    }

    lastBroadcastWorkgroupCollaborationSnapshotHashByWorkgroup.set(workgroupId, payloadHash);
    relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_COLLABORATION_SNAPSHOT,
      agent_id: agentId,
      workgroup_id: workgroupId,
      ts: Date.now(),
      payload,
    });
  }, WORKGROUP_COLLABORATION_RELAY_DEBOUNCE_MS));
}

function isRemoteProjectRecord(project: Project | RemoteProjectRecord): project is RemoteProjectRecord {
  return Boolean((project as RemoteProjectRecord).isRemote);
}

function getWorkgroupPmProjectId(workgroupId: string): string {
  return `${WORKGROUP_PM_PROJECT_PREFIX}${workgroupId.trim()}`;
}

function isWorkgroupPmProjectId(projectId: string | null | undefined): boolean {
  return String(projectId ?? "").trim().startsWith(WORKGROUP_PM_PROJECT_PREFIX);
}

function getWorkgroupIdFromPmProjectId(projectId: string | null | undefined): string | null {
  const normalized = String(projectId ?? "").trim();
  if (!isWorkgroupPmProjectId(normalized)) {
    return null;
  }
  return normalized.slice(WORKGROUP_PM_PROJECT_PREFIX.length).trim() || null;
}

function getDefaultWorkgroupPlanPath(workgroupId: string): string {
  return path.join(app.getPath("userData"), "workgroup-plans", workgroupId);
}

function resolveWorkgroupPlanPath(workgroupId: string, planWorkspacePath: string | null | undefined): string {
  const fallbackPath = getDefaultWorkgroupPlanPath(workgroupId);
  const trimmed = typeof planWorkspacePath === "string" ? planWorkspacePath.trim() : "";
  if (!trimmed) {
    fs.mkdirSync(fallbackPath, { recursive: true });
    return fallbackPath;
  }

  const resolved = path.resolve(trimmed);
  const fallbackResolved = path.resolve(fallbackPath);
  const isManagedWorkgroupPath = (
    path.basename(resolved).toLowerCase() === workgroupId.toLowerCase()
    && path.basename(path.dirname(resolved)).toLowerCase() === "workgroup-plans"
  );
  const currentUserDataPath = path.resolve(app.getPath("userData"));
  const shouldMigrateToCurrentDataRoot = (
    isManagedWorkgroupPath
    && resolved !== fallbackResolved
    && !resolved.toLowerCase().startsWith(currentUserDataPath.toLowerCase())
  );

  if (shouldMigrateToCurrentDataRoot) {
    if (fs.existsSync(resolved)) {
      fs.mkdirSync(path.dirname(fallbackResolved), { recursive: true });
      fs.cpSync(resolved, fallbackResolved, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
    } else {
      fs.mkdirSync(fallbackResolved, { recursive: true });
    }
    return fallbackResolved;
  }

  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function ensureWorkgroupPlanDirectory(planWorkspacePath: string | null | undefined): string | null {
  const resolved = typeof planWorkspacePath === "string" ? planWorkspacePath.trim() : "";
  if (!resolved) {
    return null;
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function getWorkgroupPmBinding(
  workgroupId: string,
  fallback?: Partial<Pick<Workgroup, "planWorkspacePath">> & Partial<Pick<WorkgroupMember, "projectName" | "projectPath">>,
): ResolvedWorkgroupProjectBinding {
  const workgroup = workgroupStore.getWorkgroupById(workgroupId);
  const planWorkspacePath = resolveWorkgroupPlanPath(
    workgroupId,
    workgroup?.planWorkspacePath
    ?? fallback?.planWorkspacePath
    ?? fallback?.projectPath
    ?? getDefaultWorkgroupPlanPath(workgroupId),
  );
  return {
    projectId: getWorkgroupPmProjectId(workgroupId),
    projectName: fallback?.projectName?.trim() || "PM Agent",
    projectPath: planWorkspacePath,
    projectKind: "local",
    projectExists: Boolean(planWorkspacePath),
    projectOnline: true,
  };
}

function resolveWorkgroupProjectBinding(
  projectId?: string | null,
  fallback?: Partial<Pick<WorkgroupMember, "projectName" | "projectPath" | "projectKind" | "kind">> & Partial<Pick<Workgroup, "planWorkspacePath">>,
): ResolvedWorkgroupProjectBinding {
  const normalizedProjectId = typeof projectId === "string" && projectId.trim() ? projectId.trim() : null;
  if ((fallback?.kind === "pm" || isWorkgroupPmProjectId(normalizedProjectId)) && normalizedProjectId) {
    const workgroupId = getWorkgroupIdFromPmProjectId(normalizedProjectId);
    if (workgroupId) {
      return getWorkgroupPmBinding(workgroupId, fallback);
    }
  }
  if (normalizedProjectId) {
    const liveProject = getProjectById(normalizedProjectId);
    if (liveProject) {
      const remote = isRemoteProjectRecord(liveProject);
      return {
        projectId: liveProject.id,
        projectName: liveProject.name,
        projectPath: liveProject.path,
        projectKind: remote ? "remote" : "local",
        projectExists: true,
        projectOnline: remote ? liveProject.online !== false : true,
      };
    }
  }

  return {
    projectId: normalizedProjectId,
    projectName: fallback?.projectName?.trim() || null,
    projectPath: fallback?.projectPath?.trim() || null,
    projectKind: fallback?.projectKind === "remote" ? "remote" : (fallback?.projectKind === "local" ? "local" : null),
    projectExists: false,
    projectOnline: false,
  };
}

function getWorkgroupProjectBindingLabel(binding: ResolvedWorkgroupProjectBinding): string {
  if (!binding.projectId) {
    return "Unbound";
  }

  if (isWorkgroupPmProjectId(binding.projectId)) {
    return "PM Agent: planning workspace";
  }

  const kindLabel = binding.projectKind === "remote" ? "Remote" : "Local";
  const name = binding.projectName || binding.projectId;
  const suffix = binding.projectExists
    ? (binding.projectOnline ? "online" : "offline")
    : "missing";
  return `${kindLabel}: ${name} (${suffix})`;
}

function serializeWorkgroupMember(member: WorkgroupMember): WorkgroupMemberView {
  const binding = resolveWorkgroupProjectBinding(member.projectId, member);
  return {
    ...member,
    ...binding,
    projectBindingLabel: getWorkgroupProjectBindingLabel(binding),
  };
}

function getWorkgroupDispatchBlockedReason(
  task: WorkgroupTask,
  assignee: WorkgroupMemberView | null,
): string | null {
  if (!task.assigneeMemberId || !assignee) {
    return "Task has no assignee.";
  }
  if (task.status === "assigned" || task.status === "running") {
    return "Task is already dispatched. Reset or finish it before dispatching again.";
  }
  if (!assignee.projectId || !assignee.projectExists) {
    return "Assignee is not bound to an available project.";
  }
  if (assignee.projectKind === "remote" && !assignee.projectOnline) {
    return "Assignee's remote project is offline.";
  }
  return null;
}

function serializeWorkgroupTask(task: WorkgroupTask, membersById: Map<string, WorkgroupMemberView>): WorkgroupTaskView {
  const assignee = task.assigneeMemberId ? membersById.get(task.assigneeMemberId) ?? null : null;
  const dispatchBlockedReason = getWorkgroupDispatchBlockedReason(task, assignee);
  return {
    ...task,
    assigneeMemberName: assignee?.name ?? null,
    assigneeRole: assignee?.role ?? null,
    assigneeProjectName: assignee?.projectName ?? null,
    assigneeProjectKind: assignee?.projectKind ?? null,
    assigneeProjectOnline: assignee?.projectOnline ?? false,
    assigneeProjectBindingLabel: assignee?.projectBindingLabel ?? null,
    dispatchReady: !dispatchBlockedReason,
    dispatchBlockedReason,
  };
}

function listSerializedWorkgroups(): WorkgroupView[] {
  return workgroupStore
    .listWorkgroups()
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((workgroup) => {
      ensurePmMember(workgroup);
      const members = workgroupStore
        .listMembers(workgroup.id)
        .map(serializeWorkgroupMember)
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
      const membersById = new Map(members.map((member) => [member.id, member]));
      const tasks = workgroupStore
        .listTasks(workgroup.id)
        .map((task) => serializeWorkgroupTask(task, membersById))
        .sort((left, right) => right.updatedAt - left.updatedAt);
      return {
        ...workgroup,
        members,
        tasks,
        selectedProjectIds: members
          .filter((member) => member.kind !== "pm" && member.projectId)
          .map((member) => member.projectId as string),
      };
    });
}

function getSerializedWorkgroupById(workgroupId: string): WorkgroupView | null {
  return listSerializedWorkgroups().find((entry) => entry.id === workgroupId) ?? null;
}

function buildWorkgroupRegistryPayload(workgroupId: string): {
  workgroup_id: string;
  name: string;
  description?: string;
  group_number?: string;
  members: Array<{
    id: string;
    name: string;
    role: WorkgroupRole;
    kind: string;
    project_id: string | null;
    project_name: string | null;
    project_kind: "local" | "remote" | null;
  }>;
} | null {
  const workgroup = workgroupStore.getWorkgroupById(workgroupId);
  if (!workgroup) {
    return null;
  }
  const members = workgroupStore.listMembers(workgroup.id).map((member) => ({
    id: member.id,
    name: member.name,
    role: member.role,
    kind: member.kind ?? "project",
    project_id: member.projectId ?? null,
    project_name: member.projectName ?? null,
    project_kind: member.projectKind ?? null,
  }));
  return {
    workgroup_id: workgroup.id,
    name: workgroup.name,
    description: workgroup.description ?? undefined,
    group_number: workgroup.groupNumber ?? undefined,
    members,
  };
}

async function requestWorkgroupRegistry<T>(
  endpoint: string,
  options: {
    method?: "GET" | "POST" | "DELETE";
    body?: Record<string, unknown>;
  } = {},
): Promise<T> {
  const config = loadConfig();
  const baseUrl = toHttpBaseUrl(config.serverUrl);
  const token = config.token?.trim() ?? "";
  if (!token) {
    throw new Error("Please log in first.");
  }

  const url = endpoint.startsWith("http") ? endpoint : `${baseUrl}${endpoint}`;
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.trim() || `Request failed with status ${response.status}`);
  }

  return await response.json() as T;
}

function ensurePmMember(workgroup: Workgroup): WorkgroupMember {
  const planWorkspacePath = resolveWorkgroupPlanPath(
    workgroup.id,
    workgroup.planWorkspacePath ?? getDefaultWorkgroupPlanPath(workgroup.id),
  );
  const pmProjectId = getWorkgroupPmProjectId(workgroup.id);
  const matchingPmMembers = workgroupStore
    .listMembers(workgroup.id)
    .filter((member) => member.kind === "pm" || member.projectId === pmProjectId);
  const existingPm = matchingPmMembers[0];
  for (const duplicate of matchingPmMembers.slice(1)) {
    workgroupStore.removeMember(duplicate.id);
  }
  if (workgroup.planWorkspacePath !== planWorkspacePath) {
    workgroupStore.saveWorkgroup({
      ...workgroup,
      id: workgroup.id,
      name: workgroup.name,
      description: workgroup.description ?? null,
      allowDirectMemberMessages: workgroup.allowDirectMemberMessages,
      groupNumber: workgroup.groupNumber ?? null,
      planWorkspacePath,
      registryUpdatedAt: workgroup.registryUpdatedAt ?? null,
    });
  }
  return workgroupStore.saveMember({
    id: existingPm?.id,
    workgroupId: workgroup.id,
    name: existingPm?.name?.trim() || "PM Agent",
    role: "project_manager",
    kind: "pm",
    projectId: pmProjectId,
    projectName: "PM Agent",
    projectPath: planWorkspacePath,
    projectKind: "local",
    allowedPaths: [planWorkspacePath],
    systemPrompt: existingPm?.systemPrompt?.trim()
      || "Coordinate the workgroup, keep plans in this workspace, break goals into clear subtasks, and summarize final outcomes.",
  });
}

function normalizeAllWorkgroupPmMembers(): void {
  for (const workgroup of workgroupStore.listWorkgroups()) {
    ensurePmMember(workgroup);
  }
}

function syncWorkgroupMembersFromSelection(workgroup: Workgroup, selectedProjectIds: string[]): void {
  const selectedIds = Array.from(
    new Set(
      selectedProjectIds
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => Boolean(entry) && !isWorkgroupPmProjectId(entry)),
    ),
  );
  const existingMembers = workgroupStore.listMembers(workgroup.id);
  const projectMembers = existingMembers.filter((member) => member.kind !== "pm");
  const existingByProjectId = new Map(
    projectMembers
      .filter((member) => member.projectId)
      .map((member) => [member.projectId as string, member] as const),
  );

  for (const member of projectMembers) {
    if (!member.projectId || selectedIds.includes(member.projectId)) {
      continue;
    }
    workgroupStore.removeMember(member.id);
  }

  for (const projectId of selectedIds) {
    const binding = resolveWorkgroupProjectBinding(projectId);
    if (!binding.projectExists || !binding.projectId) {
      continue;
    }
    const existing = existingByProjectId.get(projectId);
    workgroupStore.saveMember({
      id: existing?.id,
      workgroupId: workgroup.id,
      name: existing?.name?.trim() || binding.projectName || projectId,
      role: existing?.role || (binding.projectKind === "remote" ? "qa" : "developer"),
      kind: "project",
      projectId: binding.projectId,
      projectName: binding.projectName,
      projectPath: binding.projectPath,
      projectKind: binding.projectKind,
      allowedPaths: existing?.allowedPaths ?? [],
      systemPrompt: existing?.systemPrompt ?? null,
    });
  }

  ensurePmMember(workgroup);
}

async function publishWorkgroupRegistry(workgroupId: string): Promise<WorkgroupRegistryRecord> {
  const payload = buildWorkgroupRegistryPayload(workgroupId);
  if (!payload) {
    throw new Error("Workgroup not found");
  }
  const response = await requestWorkgroupRegistry<{ record: WorkgroupRegistryRecord }>("/api/workgroups/registry/publish", {
    method: "POST",
    body: payload,
  });
  const current = workgroupStore.getWorkgroupById(workgroupId);
  if (current) {
    workgroupStore.saveWorkgroup({
      ...current,
      id: current.id,
      name: current.name,
      description: current.description ?? null,
      allowDirectMemberMessages: current.allowDirectMemberMessages,
      groupNumber: response.record.groupNumber,
      planWorkspacePath: current.planWorkspacePath ?? getDefaultWorkgroupPlanPath(current.id),
      registryUpdatedAt: response.record.updatedAt,
    });
  }
  return response.record;
}

async function removeWorkgroupRegistry(workgroupId: string): Promise<void> {
  await requestWorkgroupRegistry<{ success: boolean }>(
    `/api/workgroups/registry?workgroup_id=${encodeURIComponent(workgroupId)}`,
    { method: "DELETE" },
  );
}

function buildWorkgroupRelayPayload(): { agent_id: string; workgroups: WorkgroupView[] } | null {
  const agentId = loadConfig().agentId.trim();
  if (!agentId) {
    return null;
  }
  return {
    agent_id: agentId,
    workgroups: listSerializedWorkgroups(),
  };
}

function broadcastWorkgroupsChanged(): void {
  const workgroups = listSerializedWorkgroups();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workgroups-changed", workgroups);
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("workgroups-changed", workgroups);
  }

  const relayPayload = buildWorkgroupRelayPayload();
  if (relayClient && relayClient.isConnected() && relayPayload) {
    const payloadHash = JSON.stringify(relayPayload);
    if (payloadHash === lastWorkgroupRelayPayloadHash) {
      workgroupCollaborationService.notifyWorkgroupStructureChanged();
      return;
    }
    lastWorkgroupRelayPayloadHash = payloadHash;
    relayClient.send({
      id: uuidv4(),
      event: Events.WORKGROUP_LIST,
      agent_id: relayPayload.agent_id,
      ts: Date.now(),
      payload: relayPayload,
    });
  }
  workgroupCollaborationService.notifyWorkgroupStructureChanged();
}

function buildWorkgroupDispatchPrompt(
  workgroup: Workgroup,
  member: WorkgroupMemberView,
  task: WorkgroupTask,
): string {
  const collaborationRule = workgroup.allowDirectMemberMessages
    ? "You may reference other members for handoff notes, but do not fabricate completed work from them."
    : "Do not simulate direct conversations with other members. Complete only your assigned portion and leave handoff notes when needed.";
  const roleRule = member.role === "qa"
    ? "Focus on testing, verification, deployment checks, and evidence. Avoid broad code refactors unless the task explicitly requires it."
    : (member.role === "project_manager"
      ? "Act as a coordinator. Break work down, summarize status, and assign follow-ups. Do not make code changes unless the task explicitly asks for it."
      : (member.role === "developer"
        ? "Focus on implementation inside the assigned project. Keep changes scoped and practical."
        : "Follow the custom role instructions below while staying within the assigned scope."));
  const allowedPaths = member.allowedPaths.length > 0
    ? member.allowedPaths.map((entry) => `- ${entry}`).join("\n")
    : "- No extra path restriction was configured. Stay within the assigned project.";
  const taskDescription = task.description?.trim() || "No additional description provided.";
  const acceptanceCriteria = task.acceptanceCriteria?.trim() || "No explicit acceptance criteria provided.";
  const customPrompt = member.systemPrompt?.trim()
    ? `Custom member instructions:\n${member.systemPrompt.trim()}\n\n`
    : "";

  return [
    "Workgroup execution context",
    `Workgroup: ${workgroup.name}`,
    `Member: ${member.name}`,
    `Role: ${member.role}`,
    `Bound project: ${member.projectName || member.projectId || "unbound"}`,
    "",
    "Operating rules",
    roleRule,
    collaborationRule,
    "Only operate inside the bound project and the allowed paths below.",
    allowedPaths,
    "",
    customPrompt.trim(),
    customPrompt ? "" : "",
    "Assigned task",
    `Title: ${task.title}`,
    `Priority: ${task.priority}`,
    `Description: ${taskDescription}`,
    `Acceptance criteria: ${acceptanceCriteria}`,
    "",
    "Response format",
    "Provide a concise execution report with: outcome, changed files or commands, validation result, blockers or handoff notes.",
  ]
    .filter((entry, index, source) => !(entry === "" && source[index - 1] === ""))
    .join("\n");
}

function touchWorkgroup(workgroupId: string): void {
  const workgroup = workgroupStore.getWorkgroupById(workgroupId);
  if (!workgroup) {
    return;
  }
  const planWorkspacePath = resolveWorkgroupPlanPath(
    workgroup.id,
    workgroup.planWorkspacePath ?? getDefaultWorkgroupPlanPath(workgroup.id),
  );
  workgroupStore.saveWorkgroup({
    ...workgroup,
    id: workgroup.id,
    name: workgroup.name,
    description: workgroup.description ?? null,
    allowDirectMemberMessages: workgroup.allowDirectMemberMessages,
    groupNumber: workgroup.groupNumber ?? null,
    planWorkspacePath,
    registryUpdatedAt: workgroup.registryUpdatedAt ?? null,
  });
}

function updateWorkgroupTask(taskId: string, updates: Partial<WorkgroupTask>): WorkgroupTask | null {
  const task = workgroupStore.getTaskById(taskId);
  if (!task) {
    return null;
  }

  const nextTask = workgroupStore.saveTask({
    ...task,
    ...updates,
    id: task.id,
    workgroupId: task.workgroupId,
    title: updates.title ?? task.title,
  });
  touchWorkgroup(task.workgroupId);
  return nextTask;
}

function getDispatchedAssistantMessageId(task: WorkgroupTask): string | null {
  const runId = task.dispatchRunId?.trim() || "";
  return runId ? `${runId}:assistant` : null;
}

function syncWorkgroupTasksForProjectSnapshot(snapshot: ProjectSessionSnapshot): void {
  const trackedTasks = workgroupStore.listTasks().filter((task) => (
    task.dispatchProjectId === snapshot.projectId
    && Boolean(task.dispatchRunId)
    && (task.status === "assigned" || task.status === "running")
  ));
  if (trackedTasks.length === 0) {
    return;
  }

  let changed = false;
  for (const task of trackedTasks) {
    const runId = task.dispatchRunId?.trim() || "";
    if (!runId) {
      continue;
    }

    const assistantMessageId = getDispatchedAssistantMessageId(task);
    const queued = snapshot.queue.some((entry) => entry.runId === runId);
    const userMessage = snapshot.messages.find((entry) => entry.id === runId);
    const assistantMessage = assistantMessageId
      ? snapshot.messages.find((entry) => entry.id === assistantMessageId)
      : undefined;
    const errorMessage = assistantMessageId
      ? snapshot.messages.find((entry) => entry.id === `${assistantMessageId}:error`)
      : undefined;

    let nextStatus: WorkgroupTaskStatus | null = null;
    let nextResult: string | null | undefined;

    if (errorMessage) {
      nextStatus = "error";
      nextResult = errorMessage.content?.trim() || "Assigned member project reported an error.";
    } else if (queued) {
      nextStatus = "assigned";
      nextResult = "Waiting in the assigned member project queue.";
    } else if (assistantMessage?.status === "streaming") {
      nextStatus = "running";
      nextResult = "Assigned member project is generating a response.";
    } else if (assistantMessage?.status === "done") {
      nextStatus = "done";
      nextResult = "Completed by assigned member project.";
    } else if (
      snapshot.isRunning
      && (
        (Boolean(userMessage) && !assistantMessage)
        || (
          typeof snapshot.currentStartedAt === "number"
          && typeof task.lastDispatchAt === "number"
          && snapshot.currentStartedAt >= task.lastDispatchAt
        )
      )
    ) {
      nextStatus = "running";
      nextResult = "Assigned member project is executing the dispatched task.";
    }

    if (!nextStatus) {
      continue;
    }

    if (task.status === nextStatus && (nextResult === undefined || task.lastDispatchResult === nextResult)) {
      continue;
    }

    updateWorkgroupTask(task.id, {
      status: nextStatus,
      lastDispatchResult: nextResult,
    });
    changed = true;
  }

  if (changed) {
    broadcastWorkgroupsChanged();
  }
}

function broadcastSessionSync(snapshot: ProjectSessionSnapshot): void {
  if (!relayClient || !relayClient.isConnected()) {
    return;
  }

  pendingRelaySyncSnapshotsByProject.set(snapshot.projectId, snapshot);
  const existingTimer = relaySyncTimersByProject.get(snapshot.projectId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  relaySyncTimersByProject.set(snapshot.projectId, setTimeout(() => {
    relaySyncTimersByProject.delete(snapshot.projectId);
    const latestSnapshot = pendingRelaySyncSnapshotsByProject.get(snapshot.projectId);
    if (!latestSnapshot || !relayClient || !relayClient.isConnected()) {
      return;
    }

    const afterSeq = lastBroadcastSyncSeqByProject.has(latestSnapshot.projectId)
      ? (lastBroadcastSyncSeqByProject.get(latestSnapshot.projectId) ?? 0)
      : 0;
    const delta = runtimeManager.buildSyncDelta(latestSnapshot.projectId, { afterSeq });
    const payload = buildSessionSyncPayload(latestSnapshot, delta, { afterSeq });
    const payloadHash = JSON.stringify(payload);
    if (lastBroadcastSyncPayloadHashByProject.get(latestSnapshot.projectId) === payloadHash) {
      return;
    }

    lastBroadcastSyncSeqByProject.set(latestSnapshot.projectId, delta.latestSeq);
    lastBroadcastSyncPayloadHashByProject.set(latestSnapshot.projectId, payloadHash);
    relayClient.send({
      id: uuidv4(),
      event: Events.SESSION_SYNC,
      project_id: latestSnapshot.projectId,
      ts: Date.now(),
      payload,
    });
  }, RELAY_SYNC_DEBOUNCE_MS));
}

function clearRelaySyncState(projectId?: string): void {
  const projectIds = projectId ? [projectId] : Array.from(new Set([
    ...relaySyncTimersByProject.keys(),
    ...pendingRelaySyncSnapshotsByProject.keys(),
    ...lastBroadcastSyncPayloadHashByProject.keys(),
    ...lastBroadcastSyncSeqByProject.keys(),
  ]));

  for (const currentProjectId of projectIds) {
    const timer = relaySyncTimersByProject.get(currentProjectId);
    if (timer) {
      clearTimeout(timer);
      relaySyncTimersByProject.delete(currentProjectId);
    }
    pendingRelaySyncSnapshotsByProject.delete(currentProjectId);
    lastBroadcastSyncPayloadHashByProject.delete(currentProjectId);
    lastBroadcastSyncSeqByProject.delete(currentProjectId);
  }

  if (!projectId) {
    for (const [workgroupId, timer] of workgroupCollaborationRelaySnapshotTimers.entries()) {
      clearTimeout(timer);
      workgroupCollaborationRelaySnapshotTimers.delete(workgroupId);
    }
    pendingWorkgroupCollaborationRelaySnapshots.clear();
    lastBroadcastWorkgroupCollaborationSnapshotHashByWorkgroup.clear();
    lastWorkgroupCollaborationRelayPayloadHash = "";
  }
}

function revealWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }

  if (win.isMinimized()) {
    win.restore();
  }
  if (!win.isVisible()) {
    win.show();
  }

  win.focus();
  win.flashFrame(true);
  setTimeout(() => {
    if (!win.isDestroyed()) {
      win.flashFrame(false);
    }
  }, 1200);
}

function loadConfig(): AgentConfig {
  const legacyToken = configStore.get("token") as string;
  const encryptedToken = (configStore.get("encryptedToken") as string) || "";
  const resolvedToken =
    process.env.AGENT_TOKEN?.trim()
    || decodeSecretFromStore(encryptedToken)
    || legacyToken
    || "";

  if (!process.env.AGENT_TOKEN && legacyToken && !encryptedToken) {
    configStore.set("encryptedToken", encodeSecretForStore(legacyToken));
    configStore.set("token", "");
  }

  return {
    serverUrl: (process.env.RELAY_SERVER_URL ?? configStore.get("serverUrl")) as string,
    agentId: (process.env.AGENT_ID ?? configStore.get("agentId")) as string,
    token: resolvedToken,
    username: configStore.get("username") as string,
    password: decodeSecretFromStore(configStore.get("encryptedPassword") as string),
    controllerDeviceId: (configStore.get("controllerDeviceId") as string) || "",
    controllerToken: decodeSecretFromStore(configStore.get("encryptedControllerToken") as string),
    controllerTokenExpiresAt: (configStore.get("controllerTokenExpiresAt") as string) || "",
    openaiApiKey: decodeSecretFromStore(configStore.get("encryptedOpenaiApiKey") as string),
    openaiBaseUrl: (configStore.get("openaiBaseUrl") as string) || "",
    openaiDefaultModel: (configStore.get("openaiDefaultModel") as string) || "",
    anthropicApiKey: decodeSecretFromStore(configStore.get("encryptedAnthropicApiKey") as string),
    anthropicBaseUrl: (configStore.get("anthropicBaseUrl") as string) || "",
    anthropicDefaultModel: (configStore.get("anthropicDefaultModel") as string) || "",
    tokenExpiresAt: (configStore.get("tokenExpiresAt") as string) || "",
    cliProvider: ((process.env.CLI_PROVIDER ?? configStore.get("cliProvider")) as CliProvider) || "claude",
  };
}

function getPublicConfig(): Omit<AgentConfig, "encryptedToken" | "encryptedPassword" | "encryptedOpenaiApiKey" | "encryptedAnthropicApiKey"> {
  const config = loadConfig();
  return {
    serverUrl: config.serverUrl,
    agentId: config.agentId,
    token: config.token ? "__cached__" : "",
    username: config.username,
    password: config.password,
    controllerDeviceId: config.controllerDeviceId,
    controllerToken: config.controllerToken ? "__cached__" : "",
    controllerTokenExpiresAt: config.controllerTokenExpiresAt,
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    openaiDefaultModel: config.openaiDefaultModel,
    anthropicApiKey: config.anthropicApiKey,
    anthropicBaseUrl: config.anthropicBaseUrl,
    anthropicDefaultModel: config.anthropicDefaultModel,
    tokenExpiresAt: config.tokenExpiresAt,
    cliProvider: config.cliProvider,
  };
}

function getProviderEnvironment(provider: CliProvider): Record<string, string> {
  const config = loadConfig();
  if (provider === "codex") {
    const env: Record<string, string> = {};
    if (config.openaiApiKey?.trim()) {
      env.OPENAI_API_KEY = config.openaiApiKey.trim();
    }
    if (config.openaiBaseUrl?.trim()) {
      env.OPENAI_BASE_URL = config.openaiBaseUrl.trim();
    }
    return env;
  }

  const env: Record<string, string> = {};
  if (config.anthropicApiKey?.trim()) {
    env.ANTHROPIC_API_KEY = config.anthropicApiKey.trim();
    env.ANTHROPIC_AUTH_TOKEN = config.anthropicApiKey.trim();
  }
  if (config.anthropicBaseUrl?.trim()) {
    env.ANTHROPIC_BASE_URL = config.anthropicBaseUrl.trim();
  }
  return env;
}

function saveAuthState(data: {
  token: string;
  password: string;
  expiresAt: string;
  username: string;
}): void {
  configStore.set("username", data.username);
  configStore.set("encryptedPassword", encodeSecretForStore(data.password));
  configStore.set("encryptedToken", encodeSecretForStore(data.token));
  configStore.set("token", "");
  configStore.set("tokenExpiresAt", data.expiresAt);
}

function saveControllerAuthState(data: {
  token: string;
  expiresAt: string;
  deviceId: string;
}): void {
  configStore.set("controllerDeviceId", data.deviceId);
  configStore.set("encryptedControllerToken", encodeSecretForStore(data.token));
  configStore.set("controllerToken", "");
  configStore.set("controllerTokenExpiresAt", data.expiresAt);
}

function updateRelayClientAuthFromConfig(): void {
  if (!relayClient) {
    return;
  }

  const config = loadConfig();
  relayClient.updateAuth(config.serverUrl, config.agentId, config.token);
}

function getControllerDeviceId(): string {
  const config = loadConfig();
  const stored = config.controllerDeviceId?.trim() ?? "";
  if (stored) {
    return stored;
  }
  return config.agentId?.trim() ? `desktop-controller-${config.agentId.trim()}` : `desktop-controller-${uuidv4()}`;
}

function updateControllerRelayClientAuthFromConfig(): void {
  if (!controllerRelayClient) {
    return;
  }

  const config = loadConfig();
  controllerRelayClient.updateAuth(
    config.serverUrl,
    "",
    config.controllerToken ?? "",
    getControllerDeviceId(),
  );
}

function ensureRemoteRelayReady(configOverride?: AgentConfig): boolean {
  const config = configOverride ?? loadConfig();
  if (
    !config.username?.trim()
    || !config.password?.trim()
    || !config.agentId?.trim()
    || !config.controllerToken?.trim()
  ) {
    return false;
  }

  if (!controllerRelayClient || !remoteSessionStore) {
    if (controllerRelayClient) {
      controllerRelayClient.disconnect();
      controllerRelayClient = null;
    }
    remoteSessionStore = null;
    initRemoteRelay(config);
    return true;
  }

  updateControllerRelayClientAuthFromConfig();
  if (controllerRelayClient.isConnected()) {
    requestRemoteProjectCatalogRefresh();
    scheduleRemoteProjectCatalogRefresh(1_500);
    return true;
  }

  controllerRelayClient.connect();
  return true;
}

function requestRemoteProjectCatalogRefresh(): void {
  if (!remoteSessionStore || !controllerRelayClient) {
    return;
  }

  if (!controllerRelayClient.isConnected()) {
    return;
  }

  const now = Date.now();
  const delayMs = REMOTE_PROJECT_CATALOG_REFRESH_MIN_INTERVAL_MS - (now - lastRemoteProjectCatalogRefreshAt);
  if (delayMs > 0) {
    if (!remoteProjectCatalogRefreshTimer) {
      remoteProjectCatalogRefreshTimer = setTimeout(() => {
        remoteProjectCatalogRefreshTimer = null;
        requestRemoteProjectCatalogRefresh();
      }, delayMs);
    }
    return;
  }

  lastRemoteProjectCatalogRefreshAt = now;
  remoteSessionStore.requestProjectList();
}

function scheduleRemoteProjectCatalogRefresh(delayMs: number): void {
  setTimeout(() => {
    requestRemoteProjectCatalogRefresh();
  }, Math.max(0, delayMs));
}

async function refreshRemoteWorkgroupCatalog(force: boolean = false): Promise<void> {
  if (!remoteWorkgroupStore) {
    return;
  }
  const now = Date.now();
  if (!force && now - lastRemoteWorkgroupCatalogRefreshAt < REMOTE_WORKGROUP_CATALOG_REFRESH_MIN_INTERVAL_MS) {
    return;
  }
  lastRemoteWorkgroupCatalogRefreshAt = now;

  try {
    const response = await requestWorkgroupRegistry<{ records: WorkgroupRegistryRecord[] }>("/api/workgroups/registry/mine");
    remoteWorkgroupStore.setRegistryRecords((response.records ?? []) as RemoteWorkgroupRegistryRecord[]);
    if (controllerRelayClient?.isConnected()) {
      remoteWorkgroupStore.requestSummaries();
    }
    broadcastWorkgroupCollaborationSummaries();
  } catch (error) {
    lastRemoteWorkgroupCatalogRefreshAt = 0;
    appLogger.warn("workgroup", "Failed to refresh remote workgroup catalog.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleTokenRefresh(delayOverrideMs?: number): void {
  if (tokenRefreshTimer) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }

  const config = loadConfig();
  if (!config.agentId || !config.username?.trim() || !config.password?.trim()) {
    return;
  }

  const delayMs = clampTimeoutDelayMs(delayOverrideMs ?? (() => {
    if (!config.tokenExpiresAt) {
      return MIN_TOKEN_REFRESH_DELAY_MS;
    }

    const expiresAtMs = Date.parse(config.tokenExpiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return MIN_TOKEN_REFRESH_DELAY_MS;
    }

    return Math.max(MIN_TOKEN_REFRESH_DELAY_MS, expiresAtMs - Date.now() - TOKEN_REFRESH_WINDOW_MS);
  })());

  tokenRefreshTimer = setTimeout(() => {
    void refreshAgentToken(true);
  }, delayMs);
}

function scheduleControllerTokenRefresh(delayOverrideMs?: number): void {
  if (controllerTokenRefreshTimer) {
    clearTimeout(controllerTokenRefreshTimer);
    controllerTokenRefreshTimer = null;
  }

  const config = loadConfig();
  if (!config.username?.trim() || !config.password?.trim() || !config.agentId?.trim()) {
    return;
  }

  const delayMs = clampTimeoutDelayMs(delayOverrideMs ?? (() => {
    if (!config.controllerTokenExpiresAt) {
      return MIN_TOKEN_REFRESH_DELAY_MS;
    }
    const expiresAtMs = Date.parse(config.controllerTokenExpiresAt);
    if (Number.isNaN(expiresAtMs)) {
      return MIN_TOKEN_REFRESH_DELAY_MS;
    }
    return Math.max(MIN_TOKEN_REFRESH_DELAY_MS, expiresAtMs - Date.now() - TOKEN_REFRESH_WINDOW_MS);
  })());

  controllerTokenRefreshTimer = setTimeout(() => {
    void refreshControllerToken(true);
  }, delayMs);
}

async function refreshAgentToken(force: boolean = false): Promise<boolean> {
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    const config = loadConfig();
    if (!config.agentId) {
      return false;
    }

    if (!force && config.token && !isTokenExpiringSoon(config.tokenExpiresAt)) {
      scheduleTokenRefresh();
      updateRelayClientAuthFromConfig();
      return true;
    }

    if (!config.username?.trim() || !config.password?.trim()) {
      scheduleTokenRefresh();
      return Boolean(config.token) && !isTokenExpiringSoon(config.tokenExpiresAt);
    }

    try {
      const response = await fetch(`${toHttpBaseUrl(config.serverUrl)}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: config.username,
          password: config.password,
          client_type: "agent",
          client_id: config.agentId,
        }),
      });

      if (!response.ok) {
        scheduleTokenRefresh(MIN_TOKEN_REFRESH_DELAY_MS);
        return Boolean(config.token) && !isTokenExpiringSoon(config.tokenExpiresAt);
      }

      const result = await response.json() as { token: string; expires_at: string; user?: { username?: string } };
      saveAuthState({
        token: result.token,
        password: config.password,
        expiresAt: result.expires_at,
        username: result.user?.username?.trim() || config.username,
      });
      updateRelayClientAuthFromConfig();
      scheduleTokenRefresh();
      return true;
    } catch (_error) {
      scheduleTokenRefresh(MIN_TOKEN_REFRESH_DELAY_MS);
      return Boolean(config.token) && !isTokenExpiringSoon(config.tokenExpiresAt);
    }
  })();

  try {
    return await tokenRefreshPromise;
  } finally {
    tokenRefreshPromise = null;
  }
}

async function refreshControllerToken(force: boolean = false): Promise<boolean> {
  if (controllerTokenRefreshPromise) {
    return controllerTokenRefreshPromise;
  }

  controllerTokenRefreshPromise = (async () => {
    const config = loadConfig();
    const deviceId = getControllerDeviceId();
    if (!config.username?.trim() || !config.password?.trim() || !config.agentId?.trim()) {
      return false;
    }

    if (!force && config.controllerToken && !isTokenExpiringSoon(config.controllerTokenExpiresAt)) {
      scheduleControllerTokenRefresh();
      updateControllerRelayClientAuthFromConfig();
      ensureRemoteRelayReady(config);
      return true;
    }

    try {
      const response = await fetch(`${toHttpBaseUrl(config.serverUrl)}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: config.username,
          password: config.password,
          client_type: "device",
          client_id: deviceId,
        }),
      });

      if (!response.ok) {
        scheduleControllerTokenRefresh(MIN_TOKEN_REFRESH_DELAY_MS);
        return Boolean(config.controllerToken) && !isTokenExpiringSoon(config.controllerTokenExpiresAt);
      }

      const result = await response.json() as { token: string; expires_at: string };
      saveControllerAuthState({
        token: result.token,
        expiresAt: result.expires_at,
        deviceId,
      });
      updateControllerRelayClientAuthFromConfig();
      ensureRemoteRelayReady(loadConfig());
      scheduleControllerTokenRefresh();
      return true;
    } catch (_error) {
      scheduleControllerTokenRefresh(MIN_TOKEN_REFRESH_DELAY_MS);
      return Boolean(config.controllerToken) && !isTokenExpiringSoon(config.controllerTokenExpiresAt);
    }
  })();

  try {
    return await controllerTokenRefreshPromise;
  } finally {
    controllerTokenRefreshPromise = null;
  }
}

function createTray(): Tray {
  const icon = createTrayIcon();
  const trayInstance = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  trayInstance.setToolTip(t("tray.disconnected"));
  rebuildTrayMenu(trayInstance);
  trayInstance.on("click", () => {
    showWorkspaceWindow(activeWorkspaceProjectId ?? projectStore.getAll()[0]?.id);
  });
  return trayInstance;
}

function rebuildTrayMenu(trayInstance?: Tray): void {
  const tr = trayInstance ?? tray;
  if (!tr) return;
  const projects = projectStore.getAll();
  const projectItems: Electron.MenuItemConstructorOptions[] = projects.map((p) => ({
    label: p.name,
    click: () => showWorkspaceWindow(p.id),
  }));

  const menu = Menu.buildFromTemplate([
    { label: t("app.name"), enabled: false },
    { type: "separator" },
    ...(projectItems.length > 0
      ? projectItems
      : [{ label: t("tray.noProjects"), enabled: false } as Electron.MenuItemConstructorOptions]),
    { type: "separator" },
    { label: t("tray.settings"), click: () => openSettingsWindow() },
    { label: t("tray.quit"), click: () => app.quit() },
  ]);
  tr.setContextMenu(menu);
}

function showMainWindow(parentWindow?: BrowserWindow | null): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(getSettingsWindowTitle(activeSettingsPane));
    broadcastSettingsPane();
    revealWindow(mainWindow);
    return;
  }
  const initialState = getWindowState("settingsWindow");
  mainWindow = new BrowserWindow(buildWindowOptions("settingsWindow", {
    title: getSettingsWindowTitle(activeSettingsPane),
    icon: createAppIcon(256),
    frame: false,
    transparent: false,
    backgroundColor: "#0d1117",
    parent: parentWindow ?? undefined,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }));
  bindWindowStatePersistence("settingsWindow", mainWindow);
  mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "settings.html"));
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("lang-changed", getLangPayload());
      mainWindow.webContents.send("update-state-changed", updateManager.getState());
      mainWindow.webContents.send("settings-pane-changed", activeSettingsPane);
    }
  });
  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      if (initialState.maximized) {
        mainWindow.maximize();
      }
      revealWindow(mainWindow);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createWorkspaceWindow(): BrowserWindow {
  const initialState = getWindowState("workspaceWindow");
  const win = new BrowserWindow(buildWindowOptions("workspaceWindow", {
    title: getWorkspaceWindowTitle(activeWorkspaceProjectId),
    icon: createAppIcon(256),
    frame: false,
    transparent: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),

      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: "#0d1117",
  }));
  bindWindowStatePersistence("workspaceWindow", win);

  win.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  win.once("ready-to-show", () => {
    if (initialState.maximized) {
      win.maximize();
    }
    revealWindow(win);
  });

  win.on("focus", () => {
    requestRemoteProjectCatalogRefresh();
    void refreshRemoteWorkgroupCatalog(true);
  });

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("lang-changed", getLangPayload());
    win.webContents.send("update-state-changed", updateManager.getState());
    win.webContents.send("projects-changed", getAllProjects());
    win.webContents.send("workgroup-collaboration-summaries", workgroupCollaborationService.listSummaries());
    for (const project of getAllProjects()) {
      const snapshot = getProjectSnapshot(project.id);
      if (snapshot) {
        win.webContents.send("project-session-snapshot", snapshot);
      }
    }
    if (activeWorkspaceProjectId) {
      win.webContents.send("project-id", activeWorkspaceProjectId);
    }
  });

  win.on("closed", () => {
    if (workspaceWindow === win) {
      workspaceWindow = null;
    }
  });

  return win;
}

function showWorkspaceWindow(projectId?: string): void {
  if (projectId) {
    activeWorkspaceProjectId = projectId;
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.setTitle(getWorkspaceWindowTitle(activeWorkspaceProjectId));
    if (activeWorkspaceProjectId) {
      workspaceWindow.webContents.send("project-id", activeWorkspaceProjectId);
    }
    revealWindow(workspaceWindow);
    return;
  }

  workspaceWindow = createWorkspaceWindow();
}

function openSettingsWindow(pane: SettingsPane = "system"): void {
  activeSettingsPane = normalizeSettingsPane(pane);
  showMainWindow(workspaceWindow);
}

function sendProjectBind(project: Project, agentId: string): void {
  if (!relayClient || !relayClient.isConnected()) return;
  relayClient.send({
    id: uuidv4(),
    event: "project.bind",
    project_id: project.id,
    ts: Date.now(),
    payload: {
      project_id: project.id,
      name: project.name,
      path: project.path,
      agent_id: agentId,
      group_name: project.groupName ?? "",
      cli_provider: project.cliProvider,
      cli_model: project.cliModel ?? "",
      project_prompt: project.projectPrompt ?? "",
    },
  });
}

function syncProjectCatalog(agentId: string): void {
  if (!relayClient || !relayClient.isConnected()) {
    return;
  }

  relayClient.send({
    id: uuidv4(),
    event: Events.PROJECT_LIST,
    ts: Date.now(),
    payload: buildProjectListPayload(agentId),
  });
}

function initRelay(config: AgentConfig): void {
  if (!config.agentId || !config.token) {
    console.warn("[Main] agentId or token not configured — relay not started");
    return;
  }

  relayClient = new RelayClient(
    config.serverUrl,
    config.agentId,
    config.token,
    appSettingsStore.get("e2eEnabled") as boolean,
  );
  new MessageRouter(relayClient, {
    runtimeManager,
    getDefaultCliProvider,
    syncProjectCatalog: () => syncProjectCatalog(loadConfig().agentId),
    getWorkgroupRelayPayload: () => buildWorkgroupRelayPayload(),
    dispatchWorkgroupTask: (taskId: string) => handleDispatchWorkgroupTaskRequest(taskId),
    updateWorkgroupTaskStatus: (data) => handleUpdateWorkgroupTaskStatusRequest(data),
    getWorkgroupCollaborationRelayPayload: () => buildWorkgroupCollaborationRelayPayload(),
    getWorkgroupCollaborationSessionPayload: (data) => buildWorkgroupCollaborationSessionRelayPayload(data),
    sendWorkgroupCollaborationMessage: (data) => workgroupCollaborationService.sendUserMessage(data.workgroupId, data.content),
    onProjectsChanged: () => {
      rebuildTrayMenu();
      broadcastProjectsChanged();
      updateWindowTitles();
    },
  });

  relayClient.on("connected", () => {
    console.log("[Main] Relay connected");
    clearRelaySyncState();
    lastWorkgroupRelayPayloadHash = "";
    lastWorkgroupCollaborationRelayPayloadHash = "";
    for (const project of projectStore.getAll()) {
      lastBroadcastSyncSeqByProject.set(project.id, runtimeManager.getLatestSyncSeq(project.id));
    }
    updateTrayTooltip();
    scheduleTokenRefresh();
    syncProjectCatalog(loadConfig().agentId);
    broadcastWorkgroupCollaborationRelaySummaries();
  });

  relayClient.on("disconnected", () => {
    console.log("[Main] Relay disconnected");
    clearRelaySyncState();
    lastWorkgroupRelayPayloadHash = "";
    lastWorkgroupCollaborationRelayPayloadHash = "";
    updateTrayTooltip();
  });

  relayClient.on("auth-failed", () => {
    void refreshAgentToken(true);
  });

  relayClient.on("error", (err: Error) => {
    console.error("[Main] Relay error:", err.message);
  });

  relayClient.connect();
}

function initRemoteRelay(config: AgentConfig): void {
  if (!config.username?.trim() || !config.password?.trim() || !config.agentId?.trim()) {
    return;
  }

  const controllerDeviceId = getControllerDeviceId();
  if (!config.controllerToken?.trim()) {
    return;
  }

  controllerRelayClient = new RelayClient(
    config.serverUrl,
    "",
    config.controllerToken,
    appSettingsStore.get("e2eEnabled") as boolean,
    {
      clientType: "device",
      deviceId: controllerDeviceId,
      resolveTargetAgentId: (env) => {
        const envelopeAgentId = env.agent_id?.trim() ?? "";
        if (envelopeAgentId) {
          return envelopeAgentId;
        }
        const payload = (env.payload ?? {}) as Record<string, unknown>;
        const payloadAgentId = typeof payload.agent_id === "string" ? payload.agent_id.trim() : "";
        if (payloadAgentId) {
          return payloadAgentId;
        }
        const projectId = env.project_id?.trim() ?? "";
        if (!projectId) {
          return null;
        }
        return remoteSessionStore?.getProjectAgentId(projectId) ?? null;
      },
    },
  );
  remoteSessionStore = new RemoteSessionStore(controllerRelayClient, {
    localAgentId: () => loadConfig().agentId,
  });
  remoteWorkgroupStore = new RemoteWorkgroupStore(controllerRelayClient, {
    localAgentId: () => loadConfig().agentId,
  });

  remoteSessionStore.on("projects-changed", () => {
    broadcastProjectsChanged();
    updateWindowTitles();
  });
  remoteSessionStore.on("snapshot", (projectId: string, snapshot: ProjectSessionSnapshot) => {
    syncWorkgroupTasksForProjectSnapshot(snapshot);
    if (workspaceWindow && !workspaceWindow.isDestroyed()) {
      workspaceWindow.webContents.send("project-session-snapshot", snapshot);
    }
  });
  remoteWorkgroupStore.on("summaries", () => {
    broadcastWorkgroupCollaborationSummaries();
  });
  remoteWorkgroupStore.on("snapshot", (_workgroupId: string, snapshot: WorkgroupCollaborationSessionSnapshot) => {
    if (workspaceWindow && !workspaceWindow.isDestroyed()) {
      workspaceWindow.webContents.send("workgroup-collaboration-snapshot", snapshot);
    }
  });

  controllerRelayClient.on("connected", () => {
    scheduleControllerTokenRefresh();
    requestRemoteProjectCatalogRefresh();
    scheduleRemoteProjectCatalogRefresh(1_500);
    scheduleRemoteProjectCatalogRefresh(5_000);
    void refreshRemoteWorkgroupCatalog(true);
  });
  controllerRelayClient.on("disconnected", () => {
    void 0;
  });
  controllerRelayClient.on("auth-failed", () => {
    void refreshControllerToken(true);
  });
  controllerRelayClient.on("message", (env: any) => {
    remoteSessionStore?.handleEnvelope(env);
    remoteWorkgroupStore?.handleEnvelope(env);
  });
  controllerRelayClient.on("error", () => {
    void 0;
  });
  controllerRelayClient.connect();
}

function handleUpdateWorkgroupTaskStatusRequest(data: {
  taskId: string;
  status: WorkgroupTaskStatus;
  lastDispatchResult?: string | null;
}) {
  const nextTask = updateWorkgroupTask(data.taskId, {
    status: data.status,
    dispatchProjectId: data.status === "todo" ? null : undefined,
    dispatchRunId: data.status === "todo" ? null : undefined,
    lastDispatchResult: data.lastDispatchResult ?? undefined,
  });
  if (!nextTask) {
    return { success: false, error: "Task not found" };
  }

  broadcastWorkgroupsChanged();
  return {
    success: true,
    task: nextTask,
    workgroup: getSerializedWorkgroupById(nextTask.workgroupId),
  };
}

async function handleDispatchWorkgroupTaskRequest(taskId: string) {
  const task = workgroupStore.getTaskById(taskId);
  if (!task) {
    return { success: false, error: "Task not found" };
  }
  if (!task.assigneeMemberId) {
    return { success: false, error: "Task has no assignee" };
  }

  const workgroup = workgroupStore.getWorkgroupById(task.workgroupId);
  if (!workgroup) {
    return { success: false, error: "Workgroup not found" };
  }

  const member = workgroupStore.getMemberById(task.assigneeMemberId);
  if (!member || member.workgroupId !== workgroup.id) {
    return { success: false, error: "Assignee not found" };
  }

  const serializedMember = serializeWorkgroupMember(member);
  const dispatchBlockedReason = getWorkgroupDispatchBlockedReason(task, serializedMember);
  if (dispatchBlockedReason) {
    return { success: false, error: dispatchBlockedReason };
  }

  const project = serializedMember.projectId ? getProjectById(serializedMember.projectId) : null;
  if (!project) {
    return { success: false, error: "Assigned project is unavailable" };
  }

  const dispatchAt = Date.now();
  const dispatchRunId = uuidv4();
  const snapshot = getProjectSnapshot(project.id);
  const initialStatus: WorkgroupTaskStatus = snapshot && (snapshot.isRunning || snapshot.queuedCount > 0)
    ? "assigned"
    : "running";
  const prompt = buildWorkgroupDispatchPrompt(workgroup, serializedMember, task);

  if (serializedMember.projectKind === "remote") {
    const result = remoteSessionStore
      ? await remoteSessionStore.sendPrompt(project.id, prompt)
      : { success: false, error: "Remote controller unavailable" };
    if (!result.success) {
      updateWorkgroupTask(task.id, {
        status: "error",
        dispatchProjectId: project.id,
        dispatchRunId,
        lastDispatchAt: dispatchAt,
        lastDispatchResult: result.error || "Remote dispatch failed",
      });
      broadcastWorkgroupsChanged();
      return result;
    }

    const updatedTask = updateWorkgroupTask(task.id, {
      status: initialStatus,
      dispatchProjectId: project.id,
      dispatchRunId: result.runId || dispatchRunId,
      lastDispatchAt: dispatchAt,
      lastDispatchResult: initialStatus === "assigned"
        ? "Waiting in the assigned remote member project queue."
        : "Assigned remote member project is executing the task.",
    });
    broadcastWorkgroupsChanged();
    return {
      success: true,
      task: updatedTask,
      workgroup: getSerializedWorkgroupById(task.workgroupId),
    };
  }

  runtimeManager.enqueueMessage({
    projectId: project.id,
    cwd: project.path,
    prompt,
    source: "desktop",
    runId: dispatchRunId,
    onDone: () => {
      const latestTask = workgroupStore.getTaskById(task.id);
      if (!latestTask || latestTask.dispatchRunId !== dispatchRunId) {
        return;
      }
      if (latestTask.status !== "running" && latestTask.status !== "assigned") {
        return;
      }
      updateWorkgroupTask(task.id, {
        status: "done",
        lastDispatchResult: "Completed by assigned member project.",
      });
      broadcastWorkgroupsChanged();
    },
    onError: (error) => {
      const latestTask = workgroupStore.getTaskById(task.id);
      if (!latestTask || latestTask.dispatchRunId !== dispatchRunId) {
        return;
      }
      updateWorkgroupTask(task.id, {
        status: "error",
        lastDispatchResult: error || "Local dispatch failed",
      });
      broadcastWorkgroupsChanged();
    },
  });

  const updatedTask = updateWorkgroupTask(task.id, {
    status: initialStatus,
    dispatchProjectId: project.id,
    dispatchRunId,
    lastDispatchAt: dispatchAt,
    lastDispatchResult: initialStatus === "assigned"
      ? "Queued for the assigned local member project."
      : "Assigned local member project is executing the task.",
  });
  broadcastWorkgroupsChanged();
  return {
    success: true,
    task: updatedTask,
    workgroup: getSerializedWorkgroupById(task.workgroupId),
  };
}

// IPC handlers
ipcMain.handle("get-projects", (_event, options?: { refreshRemote?: boolean } | null) => {
  if (options?.refreshRemote) {
    requestRemoteProjectCatalogRefresh();
  }
  return getAllProjects();
});

ipcMain.handle("add-project", async (_event, data: {
  name: string;
  path: string;
  groupName?: string | null;
  cliProvider?: CliProvider;
  cliModel?: string | null;
  projectPrompt?: string | null;
}) => {
  const config = loadConfig();
  const projectId = uuidv4();
  const cliProvider = normalizeCliProvider(data.cliProvider, getDefaultCliProvider());
  const cliModel = data.cliModel?.trim() ? data.cliModel.trim() : null;

  // Add to local store
  projectStore.add({
    id: projectId,
    name: data.name,
    path: data.path,
    agentId: config.agentId,
    groupName: normalizeProjectGroupName(data.groupName),
    cliProvider,
    cliModel,
    projectPrompt: data.projectPrompt?.trim() ? data.projectPrompt.trim() : null,
    createdAt: Date.now(),
  });

  // Bind to server
  syncProjectCatalog(config.agentId);

  rebuildTrayMenu();
  broadcastProjectsChanged();
  broadcastProjectSnapshot(projectId);
  return { success: true, projectId };
});

ipcMain.handle(
  "update-project",
  (_event, data: { projectId: string; updates: Partial<Pick<Project, "name" | "path" | "groupName" | "cliProvider" | "cliModel" | "projectPrompt">> }) => {
    const liveProject = getProjectById(data.projectId);
    if (!liveProject) {
      return { success: false, error: "Project not found" };
    }

    const nextUpdates: Partial<Project> = { ...data.updates };
    if (data.updates.groupName !== undefined) {
      nextUpdates.groupName = normalizeProjectGroupName(data.updates.groupName);
    }
    if (data.updates.cliProvider !== undefined) {
      nextUpdates.cliProvider = normalizeCliProvider(
        data.updates.cliProvider,
        normalizeCliProvider(liveProject.cliProvider, getDefaultCliProvider()),
      );
    }
    if (data.updates.cliModel !== undefined) {
      nextUpdates.cliModel = data.updates.cliModel?.trim() ? data.updates.cliModel.trim() : null;
    }
    if (data.updates.projectPrompt !== undefined) {
      nextUpdates.projectPrompt = data.updates.projectPrompt?.trim() ? data.updates.projectPrompt.trim() : null;
    }

    if (isRemoteProjectRecord(liveProject)) {
      const result = remoteSessionStore?.updateProjectConfig(data.projectId, {
        groupName: nextUpdates.groupName,
        cliProvider: nextUpdates.cliProvider,
        cliModel: nextUpdates.cliModel,
        projectPrompt: nextUpdates.projectPrompt,
      }) ?? { success: false, error: "Remote project sync is unavailable" };
      if (!result.success) {
        return result;
      }
      broadcastProjectsChanged();
      if (workspaceWindow && !workspaceWindow.isDestroyed()) {
        const snapshot = remoteSessionStore?.getSnapshot(data.projectId);
        if (snapshot) {
          workspaceWindow.webContents.send("project-session-snapshot", snapshot);
        }
      }
      updateWindowTitles();
      return { success: true };
    }

    projectStore.update(data.projectId, nextUpdates);
    const updatedProject = projectStore.getById(data.projectId);
    if (updatedProject) {
      syncProjectCatalog(updatedProject.agentId || loadConfig().agentId);
    }
    rebuildTrayMenu();
    broadcastProjectsChanged();
    broadcastProjectSnapshot(data.projectId);
    updateWindowTitles();
    return { success: true };
  },
);

ipcMain.handle("delete-project", (_event, projectId: string) => {
  const project = projectStore.getById(projectId);
  projectStore.remove(projectId);
  runtimeManager.clearProject(projectId);
  clearRelaySyncState(projectId);

  if (activeWorkspaceProjectId === projectId) {
    activeWorkspaceProjectId = null;
  }

  // Kill PTY if exists
  try {
    ptyManager.kill(projectId);
  } catch (err) {
    // Ignore if PTY doesn't exist
  }

  rebuildTrayMenu();
  if (project) {
    syncProjectCatalog(project.agentId || loadConfig().agentId);
  }
  broadcastProjectsChanged();
  updateWindowTitles();
  return { success: true };
});

ipcMain.on("open-project-window", (_event, projectId: string) => {
  const project = projectStore.getById(projectId);
  if (project) showWorkspaceWindow(project.id);
});

ipcMain.handle("get-config", () => getPublicConfig());

ipcMain.handle("list-access-grants", async () => {
  const refreshed = await refreshAgentToken(false);
  const config = loadConfig();
  if (!refreshed || !config.token) {
    return { success: false, error: "Not logged in" };
  }

  try {
    const response = await fetch(`${toHttpBaseUrl(config.serverUrl)}/api/access/grants`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: errorText || response.statusText };
    }
    const data = await response.json();
    requestRemoteProjectCatalogRefresh();
    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) };
  }
});

ipcMain.handle("grant-access-to-user", async (_event, data: { controllerUsername: string; note?: string | null }) => {
  const refreshed = await refreshAgentToken(false);
  const config = loadConfig();
  if (!refreshed || !config.token || !config.agentId) {
    return { success: false, error: "Not logged in" };
  }

  try {
    const response = await fetch(`${toHttpBaseUrl(config.serverUrl)}/api/access/grants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        controller_username: data.controllerUsername,
        target_agent_id: config.agentId,
        note: data.note ?? "",
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: errorText || response.statusText };
    }
    requestRemoteProjectCatalogRefresh();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) };
  }
});

ipcMain.handle("revoke-access-grant", async (_event, data: { controllerUserId: number; targetAgentId?: string | null }) => {
  const refreshed = await refreshAgentToken(false);
  const config = loadConfig();
  const targetAgentId = data.targetAgentId?.trim() || config.agentId;
  if (!refreshed || !config.token || !targetAgentId) {
    return { success: false, error: "Not logged in" };
  }

  try {
    const query = new URLSearchParams({
      controller_user_id: String(data.controllerUserId),
      target_agent_id: targetAgentId,
    });
    const response = await fetch(`${toHttpBaseUrl(config.serverUrl)}/api/access/grants?${query.toString()}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: errorText || response.statusText };
    }
    requestRemoteProjectCatalogRefresh();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message ?? String(error) };
  }
});

ipcMain.handle("save-config", (_event, config: Partial<AgentConfig>) => {
  if (config.serverUrl !== undefined) configStore.set("serverUrl", config.serverUrl);
  if (config.agentId !== undefined) configStore.set("agentId", config.agentId);
  if (config.token !== undefined) {
    configStore.set("encryptedToken", encodeSecretForStore(config.token));
    configStore.set("token", "");
  }
  if (config.username !== undefined) configStore.set("username", config.username);
  if (config.password !== undefined) configStore.set("encryptedPassword", encodeSecretForStore(config.password));
  if (config.openaiApiKey !== undefined) configStore.set("encryptedOpenaiApiKey", encodeSecretForStore(config.openaiApiKey));
  if (config.openaiBaseUrl !== undefined) configStore.set("openaiBaseUrl", config.openaiBaseUrl);
  if (config.openaiDefaultModel !== undefined) configStore.set("openaiDefaultModel", config.openaiDefaultModel);
  if (config.anthropicApiKey !== undefined) configStore.set("encryptedAnthropicApiKey", encodeSecretForStore(config.anthropicApiKey));
  if (config.anthropicBaseUrl !== undefined) configStore.set("anthropicBaseUrl", config.anthropicBaseUrl);
  if (config.anthropicDefaultModel !== undefined) configStore.set("anthropicDefaultModel", config.anthropicDefaultModel);
  if (config.cliProvider !== undefined) configStore.set("cliProvider", config.cliProvider);
  return true;
});

ipcMain.handle("login", async (_event, data: { username: string; password: string; agentId: string }) => {
  try {
    const config = loadConfig();
    const serverUrl = toHttpBaseUrl(config.serverUrl);

    const response = await fetch(`${serverUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: data.username,
        password: data.password,
        client_type: "agent",
        client_id: data.agentId,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: errorText || response.statusText };
    }

    const result = await response.json() as { token: string; expires_at: string; user?: { username?: string } };
    saveAuthState({
      token: result.token,
      password: data.password,
      expiresAt: result.expires_at,
      username: result.user?.username?.trim() || data.username,
    });
    scheduleTokenRefresh();
    updateRelayClientAuthFromConfig();
    await refreshControllerToken(true);
    updateControllerRelayClientAuthFromConfig();

    return { success: true, token: result.token, user: result.user };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-e2e-status", () => {
  return {
    enabled: relayClient?.isE2EEnabled() ?? (appSettingsStore.get("e2eEnabled") as boolean),
    publicKey: relayClient?.getE2E().getPublicKey() ?? "",
  };
});

ipcMain.handle("set-e2e-enabled", (_event, enabled: boolean) => {
  appSettingsStore.set("e2eEnabled", enabled);
  if (relayClient) relayClient.setE2EEnabled(enabled);
  if (controllerRelayClient) {
    controllerRelayClient.setE2EEnabled(enabled);
    if (enabled) {
      requestRemoteProjectCatalogRefresh();
    }
  }
  return true;
});

ipcMain.handle("reconnect-relay", async () => {
  await refreshAgentToken(false);
  await refreshControllerToken(false);
  if (relayClient) {
    relayClient.disconnect();
  }
  if (controllerRelayClient) {
    controllerRelayClient.disconnect();
    controllerRelayClient = null;
  }
  remoteSessionStore = null;
  const config = loadConfig();
  initRelay(config);
  ensureRemoteRelayReady(config);
  return true;
});

ipcMain.handle("get-lang", () => getLang());

ipcMain.handle("set-lang", (_event, lang: Lang) => {
  setLang(lang);
  updateTrayTooltip();
  rebuildTrayMenu();
  updateWindowTitles();
  broadcastLangChange();
  return true;
});

ipcMain.handle("get-i18n-messages", () => getAllMessages());

ipcMain.handle("get-app-settings", () => {
  const effectiveLocalDataRoot = getPersistedLocalDataRoot();
  syncLocalDataRootSetting(effectiveLocalDataRoot);
  return {
    autoStart: appSettingsStore.get("autoStart") as boolean,
    silentLaunch: appSettingsStore.get("silentLaunch") as boolean,
    completionSound: appSettingsStore.get("completionSound") as boolean,
    saveLogs: appSettingsStore.get("saveLogs") as boolean,
    e2eEnabled: appSettingsStore.get("e2eEnabled") as boolean,
    autoUpdateCheck: appSettingsStore.get("autoUpdateCheck") as boolean,
    autoUpdateDownload: appSettingsStore.get("autoUpdateDownload") as boolean,
    silentUpdateInstall: appSettingsStore.get("silentUpdateInstall") as boolean,
    historyRetentionDays: appSettingsStore.get("historyRetentionDays") as number,
    localDataRoot: effectiveLocalDataRoot,
    defaultLocalDataRoot: getDefaultLocalDataRoot(),
    logDirectory: appLogger.getLogDirectory(),
  };
});

ipcMain.handle("set-app-settings", (_event, settings: Partial<AppSettings>) => {
  if (settings.autoStart !== undefined) {
    appSettingsStore.set("autoStart", settings.autoStart);
    app.setLoginItemSettings({ openAtLogin: settings.autoStart });
  }
  if (settings.silentLaunch !== undefined) {
    appSettingsStore.set("silentLaunch", settings.silentLaunch);
  }
  if (settings.completionSound !== undefined) {
    appSettingsStore.set("completionSound", settings.completionSound);
  }
  if (settings.saveLogs !== undefined) {
    if (!settings.saveLogs) {
      appLogger.info("settings", "Local log persistence disabled by user.");
    }
    appSettingsStore.set("saveLogs", settings.saveLogs);
    appLogger.setEnabled(settings.saveLogs);
    if (settings.saveLogs) {
      appLogger.info("settings", "Local log persistence enabled by user.");
    }
  }
  if (settings.e2eEnabled !== undefined) {
    appSettingsStore.set("e2eEnabled", settings.e2eEnabled);
    if (relayClient) {
      relayClient.setE2EEnabled(settings.e2eEnabled);
    }
    if (controllerRelayClient) {
      controllerRelayClient.setE2EEnabled(settings.e2eEnabled);
      if (settings.e2eEnabled) {
        requestRemoteProjectCatalogRefresh();
      }
    }
  }
  if (settings.autoUpdateCheck !== undefined) {
    appSettingsStore.set("autoUpdateCheck", settings.autoUpdateCheck);
    updateManager.start();
  }
  if (settings.autoUpdateDownload !== undefined) {
    appSettingsStore.set("autoUpdateDownload", settings.autoUpdateDownload);
  }
  if (settings.silentUpdateInstall !== undefined) {
    appSettingsStore.set("silentUpdateInstall", settings.silentUpdateInstall);
    if (settings.silentUpdateInstall) {
      void updateManager.maybeInstallDownloadedUpdate();
    }
  }
  if (settings.historyRetentionDays !== undefined) {
    const normalizedRetentionDays = Math.max(1, Math.floor(Number(settings.historyRetentionDays) || 30));
    appSettingsStore.set("historyRetentionDays", normalizedRetentionDays);
    runtimeManager.pruneHistoryCache(normalizedRetentionDays);
  }
  return true;
});

ipcMain.handle("pick-local-data-root", async (event, rawPath?: string | null) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? workspaceWindow ?? undefined;
  const defaultPath = resolveLocalDataRoot(rawPath);
  const dialogOptions: Electron.OpenDialogOptions = {
    defaultPath,
    properties: ["openDirectory", "createDirectory", "promptToCreate"],
  };
  const result = senderWindow
    ? await dialog.showOpenDialog(senderWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  return {
    success: !result.canceled,
    path: result.canceled ? null : (result.filePaths[0] ?? null),
  };
});

ipcMain.handle("open-local-data-root", async (_event, rawPath?: string | null) => {
  const targetPath = resolveLocalDataRoot(rawPath ?? app.getPath("userData"));
  fs.mkdirSync(targetPath, { recursive: true });
  const errorMessage = await shell.openPath(targetPath);
  return {
    success: !errorMessage,
    error: errorMessage || undefined,
  };
});

ipcMain.handle("change-local-data-root", async (_event, rawPath?: string | null) => {
  if (runtimeManager.hasActiveOrQueuedRuns()) {
    return {
      success: false,
      error: getLang() === "zh"
        ? "请先等待运行中和排队中的任务完成，再切换本地文件目录。"
        : "Finish running and queued tasks before changing the local data folder.",
    };
  }

  const currentRoot = app.getPath("userData");
  const nextRoot = resolveLocalDataRoot(rawPath);
  if (localDataRootsEqual(currentRoot, nextRoot)) {
    syncLocalDataRootSetting(currentRoot);
    return {
      success: true,
      changed: false,
      restartRequired: false,
      localDataRoot: currentRoot,
    };
  }

  try {
    runtimeManager.flushPersistence();
    migrateLocalDataRoot(currentRoot, nextRoot);
    const persistedRoot = persistLocalDataRoot(nextRoot);
    syncLocalDataRootSetting(persistedRoot);
    appLogger.info("settings", "Local data root updated.", {
      previousRoot: currentRoot,
      nextRoot: persistedRoot,
    });
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 180);
    return {
      success: true,
      changed: true,
      restartRequired: true,
      localDataRoot: persistedRoot,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    appLogger.error("settings", "Failed to migrate local data root.", {
      previousRoot: currentRoot,
      nextRoot,
      error: detail,
    });
    return {
      success: false,
      error: detail,
    };
  }
});

ipcMain.handle("get-update-state", () => updateManager.getState());
ipcMain.handle("check-for-updates", async () => updateManager.checkForUpdates(true));
ipcMain.handle("download-available-update", async () => updateManager.downloadAvailableUpdate());
ipcMain.handle("install-downloaded-update", async () => updateManager.installDownloadedUpdate());

ipcMain.handle("get-connection-status", () => {
  if (!relayClient) {
    return { state: "disconnected" };
  }

  const isConnected = relayClient.isConnected();

  return {
    state: isConnected ? "connected" : "disconnected"
  };
});

ipcMain.handle("open-project", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (project) {
    showWorkspaceWindow(project.id);
    return { success: true };
  }
  return { success: false, error: "Project not found" };
});

ipcMain.on("open-settings-window", (event, pane?: SettingsPane) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  activeSettingsPane = normalizeSettingsPane(pane);
  showMainWindow(senderWindow ?? workspaceWindow);
});

ipcMain.on("set-active-project", (_event, projectId: string | null) => {
  activeWorkspaceProjectId = projectId;
  updateWindowTitles();
});

ipcMain.handle("get-project-session", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(projectId)) {
    remoteSessionStore?.requestSessionSync(projectId, { limit: 30 });
  }

  return {
    success: true,
    project,
    session: getProjectSnapshot(projectId),
  };
});

ipcMain.handle("get-project-history-page", async (_event, data: {
  projectId: string;
  kind: "messages" | "activities" | "cli";
  conversationId?: string | null;
  beforeId?: string | null;
  limit?: number;
}) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(data.projectId)) {
    const page = await remoteSessionStore?.loadHistoryPage(data.projectId, data.kind, {
      beforeId: data.beforeId,
      limit: data.limit,
      conversationId: data.conversationId,
    });
    if (!page) {
      return { success: false, error: "Remote project history unavailable" };
    }

    return {
      success: true,
      page,
    };
  }

  return {
    success: true,
    page: runtimeManager.getHistoryPage(data.projectId, data.kind, {
      conversationId: data.conversationId,
      beforeId: data.beforeId,
      limit: data.limit,
    }),
  };
});

ipcMain.handle("list-project-conversations", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(projectId)) {
    const snapshot = remoteSessionStore?.getSnapshot(projectId);
    return {
      success: true,
      conversations: snapshot?.conversations ?? [],
    };
  }

  return {
    success: true,
    conversations: runtimeManager.listConversationSummaries(projectId),
  };
});

ipcMain.handle("create-project-conversation", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(projectId)) {
    return remoteSessionStore?.createConversation(projectId) ?? { success: false, error: "Remote controller unavailable" };
  }

  return runtimeManager.createConversation(projectId);
});

ipcMain.handle("activate-project-conversation", (_event, data: { projectId: string; conversationId: string }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(data.projectId)) {
    return remoteSessionStore?.activateConversation(data.projectId, data.conversationId)
      ?? { success: false, error: "Remote controller unavailable" };
  }

  return runtimeManager.activateConversation(data.projectId, data.conversationId);
});

ipcMain.handle("clear-history-cache", (_event, projectId?: string | null) => {
  return {
    success: true,
    ...runtimeManager.clearHistoryCache(projectId),
  };
});

ipcMain.handle("repair-chat-history", (_event, projectId?: string | null) => {
  return {
    success: true,
    ...runtimeManager.repairChatHistory(projectId),
  };
});

ipcMain.handle("pick-project-attachments", async (event, data: { projectId: string; kind: "image" | "file" }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const senderWindow = BrowserWindow.fromWebContents(event.sender) ?? workspaceWindow ?? undefined;
  const filters = data.kind === "image"
    ? [{
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif", "heic"],
      }]
    : undefined;

  const dialogOptions: Electron.OpenDialogOptions = {
    defaultPath: isRemoteProject(data.projectId) ? app.getPath("downloads") : project.path,
    properties: ["openFile", "multiSelections"],
    filters,
  };
  const result = senderWindow
    ? await dialog.showOpenDialog(senderWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { success: true, attachments: [] };
  }

  return {
    success: true,
    attachments: result.filePaths.map((filePath) => createRunAttachmentFromPath(filePath)),
  };
});

ipcMain.handle("save-clipboard-project-image", (_event, data: { projectId: string }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return { success: false, error: "Clipboard does not contain an image" };
  }

  const targetPath = getUniqueAttachmentPath(data.projectId, `clipboard-${Date.now()}.png`);
  fs.writeFileSync(targetPath, image.toPNG());

  return {
    success: true,
    attachment: createRunAttachmentFromPath(targetPath, {
      name: path.basename(targetPath),
      kind: "image",
    }),
  };
});

ipcMain.handle("get-attachment-image-data", (_event, data: { path?: string | null }) => {
  const filePath = typeof data?.path === "string" ? path.resolve(data.path) : "";
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { success: false, error: "Attachment not found" };
  }
  if (!isImageAttachment(filePath)) {
    return { success: false, error: "Attachment is not an image" };
  }

  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    return { success: false, error: "Unable to read image" };
  }

  return {
    success: true,
    dataUrl: image.toDataURL(),
  };
});

ipcMain.handle("send-project-prompt", (_event, data: { projectId: string; prompt: string; attachments?: unknown[] }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const attachments = normalizeIncomingAttachments(data.attachments);
  if (!data.prompt.trim() && attachments.length === 0) {
    return { success: false, error: "Prompt cannot be empty" };
  }

  if (isRemoteProject(data.projectId)) {
    return remoteSessionStore?.sendPrompt(data.projectId, data.prompt, attachments)
      ?? { success: false, error: "Remote controller unavailable" };
  }

  runtimeManager.enqueueMessage({
    projectId: project.id,
    cwd: project.path,
    prompt: data.prompt,
    attachments,
    source: "desktop",
  });

  return { success: true };
});

ipcMain.handle("stop-project-run", (_event, projectId: string) => {
  const project = getProjectById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(projectId)) {
    return remoteSessionStore?.stopRun(projectId) ?? { success: false, error: "Remote controller unavailable" };
  }

  const stopped = runtimeManager.stopCurrentRun(
    project.id,
    "Run interrupted by desktop user.",
    false,
  );
  if (!stopped) {
    return { success: false, error: "No active run" };
  }

  return { success: true };
});

ipcMain.handle("remove-queued-project-prompt", (_event, data: { projectId: string; runId: string }) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(data.projectId)) {
    return remoteSessionStore?.removeQueuedRun(data.projectId, data.runId) ?? { success: false, error: "Remote controller unavailable" };
  }

  const removed = runtimeManager.removeQueuedRun(data.projectId, data.runId);
  if (!removed) {
    return { success: false, error: "Queued item not found" };
  }

  return { success: true };
});

// 窗口控制
ipcMain.handle("list-workgroups", () => {
  return {
    success: true,
    workgroups: listSerializedWorkgroups(),
  };
});

ipcMain.handle("search-project-messages", (_event, data: {
  projectId: string;
  query: string;
  conversationId?: string | null;
  limit?: number;
}) => {
  const project = getProjectById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  if (isRemoteProject(data.projectId)) {
    return {
      success: true,
      items: remoteSessionStore?.searchMessages(data.projectId, {
        query: data.query,
        conversationId: data.conversationId,
        limit: data.limit,
      }) ?? [],
    };
  }

  return {
    success: true,
    items: runtimeManager.searchMessages(data.projectId, {
      query: data.query,
      conversationId: data.conversationId,
      limit: data.limit,
    }),
  };
});

ipcMain.handle("list-workgroup-collaborations", () => {
  void refreshRemoteWorkgroupCatalog();
  return {
    success: true,
    workgroups: getAllWorkgroupCollaborationSummaries(),
  };
});

ipcMain.handle("get-workgroup-collaboration-session", async (_event, workgroupId: string) => {
  if (parseCompositeWorkgroupId(workgroupId)) {
    const existingRemoteSession = remoteWorkgroupStore?.getSession(workgroupId);
    if (existingRemoteSession) {
      return { success: true, session: existingRemoteSession };
    }
    return await (remoteWorkgroupStore?.requestSession(workgroupId, { limit: 30 }) ?? Promise.resolve({
      success: false,
      error: "Remote workgroup collaboration not found",
    }));
  }

  const session = workgroupCollaborationService.getSession(workgroupId);
  if (!session) {
    return { success: false, error: "Workgroup collaboration not found" };
  }
  return {
    success: true,
    session,
  };
});

ipcMain.handle("get-workgroup-collaboration-history-page", async (_event, data: {
  workgroupId: string;
  beforeId?: string | null;
  limit?: number;
}) => {
  if (parseCompositeWorkgroupId(data.workgroupId)) {
    const existingPage = remoteWorkgroupStore?.getHistoryPage(data.workgroupId, {
      beforeId: data.beforeId,
      limit: data.limit,
    });
    if ((!existingPage || (existingPage.items.length === 0 && existingPage.hasMore && data.beforeId)) && remoteWorkgroupStore) {
      const result = await remoteWorkgroupStore.requestSession(data.workgroupId, {
        beforeId: data.beforeId,
        limit: data.limit,
      });
      if (!result.success) {
        return result;
      }
    }
    const page = remoteWorkgroupStore?.getHistoryPage(data.workgroupId, {
      beforeId: data.beforeId,
      limit: data.limit,
    });
    if (!page) {
      return { success: false, error: "Remote workgroup collaboration not found" };
    }
    return {
      success: true,
      page,
    };
  }

  const page = workgroupCollaborationService.getHistoryPage(data.workgroupId, {
    beforeId: data.beforeId,
    limit: data.limit,
  });
  if (!page) {
    return { success: false, error: "Workgroup collaboration not found" };
  }
  return {
    success: true,
    page,
  };
});

ipcMain.handle("search-workgroup-collaboration-messages", (_event, data: {
  workgroupId: string;
  query: string;
  limit?: number;
}) => {
  if (parseCompositeWorkgroupId(data.workgroupId)) {
    const items = remoteWorkgroupStore?.searchMessages(data.workgroupId, {
      query: data.query,
      limit: data.limit,
    });
    if (!items) {
      return { success: false, error: "Remote workgroup collaboration not found" };
    }
    return {
      success: true,
      items,
    };
  }

  const items = workgroupCollaborationService.searchMessages(data.workgroupId, {
    query: data.query,
    limit: data.limit,
  });
  if (!items) {
    return { success: false, error: "Workgroup collaboration not found" };
  }
  return {
    success: true,
    items,
  };
});

ipcMain.handle("send-workgroup-collaboration-message", async (_event, data: { workgroupId: string; content: string }) => {
  if (parseCompositeWorkgroupId(data.workgroupId)) {
    return await (remoteWorkgroupStore?.sendMessage(data.workgroupId, data.content) ?? Promise.resolve({
      success: false,
      error: "Remote workgroup collaboration not found",
    }));
  }
  return await workgroupCollaborationService.sendUserMessage(data.workgroupId, data.content);
});

ipcMain.handle("save-workgroup", (_event, data: {
  id?: string;
  name: string;
  description?: string | null;
  allowDirectMemberMessages?: boolean;
  selectedProjectIds?: string[] | null;
}) => {
  const name = String(data?.name ?? "").trim();
  if (!name) {
    return { success: false, error: "Workgroup name is required" };
  }

  const existing = typeof data?.id === "string" ? workgroupStore.getWorkgroupById(data.id.trim()) : null;
  const workgroupId = existing?.id || (typeof data?.id === "string" && data.id.trim() ? data.id.trim() : uuidv4());
  const planWorkspacePath = ensureWorkgroupPlanDirectory(
    existing?.planWorkspacePath
    ?? getDefaultWorkgroupPlanPath(workgroupId),
  );

  const workgroup = workgroupStore.saveWorkgroup({
    id: workgroupId,
    name,
    description: data?.description ?? null,
    allowDirectMemberMessages: Boolean(data?.allowDirectMemberMessages),
    groupNumber: existing?.groupNumber ?? null,
    planWorkspacePath,
    registryUpdatedAt: existing?.registryUpdatedAt ?? null,
  });
  syncWorkgroupMembersFromSelection(workgroup, Array.isArray(data?.selectedProjectIds) ? data.selectedProjectIds : []);
  broadcastWorkgroupsChanged();
  return {
    success: true,
    workgroup: getSerializedWorkgroupById(workgroup.id),
  };
});

ipcMain.handle("delete-workgroup", (_event, workgroupId: string) => {
  const workgroup = workgroupStore.getWorkgroupById(workgroupId);
  if (!workgroup) {
    return { success: false, error: "Workgroup not found" };
  }

  if (workgroup.groupNumber?.trim()) {
    void removeWorkgroupRegistry(workgroup.id).catch((error) => {
      appLogger.warn("workgroup", "Failed to remove workgroup registry.", {
        workgroupId: workgroup.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  workgroupStore.removeWorkgroup(workgroupId);
  workgroupCollaborationService.removeWorkgroup(workgroupId);
  broadcastWorkgroupsChanged();
  return { success: true };
});

ipcMain.handle("publish-workgroup-registry", async (_event, workgroupId: string) => {
  try {
    const record = await publishWorkgroupRegistry(String(workgroupId ?? "").trim());
    broadcastWorkgroupsChanged();
    return {
      success: true,
      record,
      workgroup: getSerializedWorkgroupById(record.workgroupId),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("search-workgroup-registry", async (_event, query: string) => {
  try {
    const normalizedQuery = String(query ?? "").trim();
    const response = await requestWorkgroupRegistry<{ records: WorkgroupRegistryRecord[] }>(
      `/api/workgroups/registry?q=${encodeURIComponent(normalizedQuery)}`,
    );
    return {
      success: true,
      records: response.records,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("join-workgroup-registry", async (_event, groupNumber: string) => {
  try {
    const response = await requestWorkgroupRegistry<{ success: boolean; record: WorkgroupRegistryRecord; granted_access: boolean }>("/api/workgroups/registry/join", {
      method: "POST",
      body: { group_number: String(groupNumber ?? "").trim() },
    });
    void refreshRemoteWorkgroupCatalog(true);
    return {
      ...response,
      success: response.success !== false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("get-workgroup-registry-members", async (_event, data: {
  groupNumber?: string | null;
  workgroupId?: string | null;
  hostAgentId?: string | null;
}) => {
  try {
    const params = new URLSearchParams();
    const groupNumber = String(data?.groupNumber ?? "").trim();
    const workgroupId = String(data?.workgroupId ?? "").trim();
    const hostAgentId = String(data?.hostAgentId ?? "").trim();
    if (groupNumber) {
      params.set("group_number", groupNumber);
    }
    if (workgroupId) {
      params.set("workgroup_id", workgroupId);
    }
    if (hostAgentId) {
      params.set("host_agent_id", hostAgentId);
    }
    const response = await requestWorkgroupRegistry<{
      record: WorkgroupRegistryRecord;
      members: Array<{ userId: number; username: string; isOwner: boolean; joinedAt: number }>;
    }>(`/api/workgroups/registry/members?${params.toString()}`);
    return {
      success: true,
      ...response,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("leave-workgroup-registry", async (_event, data: {
  groupNumber?: string | null;
  workgroupId?: string | null;
  hostAgentId?: string | null;
}) => {
  try {
    const response = await requestWorkgroupRegistry<{ success: boolean }>("/api/workgroups/registry/leave", {
      method: "POST",
      body: {
        group_number: String(data?.groupNumber ?? "").trim() || undefined,
        workgroup_id: String(data?.workgroupId ?? "").trim() || undefined,
        host_agent_id: String(data?.hostAgentId ?? "").trim() || undefined,
      },
    });
    void refreshRemoteWorkgroupCatalog(true);
    return {
      success: response.success !== false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("kick-workgroup-registry-member", async (_event, data: {
  groupNumber?: string | null;
  workgroupId?: string | null;
  hostAgentId?: string | null;
  userId: number;
}) => {
  try {
    const response = await requestWorkgroupRegistry<{ success: boolean }>("/api/workgroups/registry/kick", {
      method: "POST",
      body: {
        group_number: String(data?.groupNumber ?? "").trim() || undefined,
        workgroup_id: String(data?.workgroupId ?? "").trim() || undefined,
        host_agent_id: String(data?.hostAgentId ?? "").trim() || undefined,
        user_id: Number(data?.userId) || 0,
      },
    });
    void refreshRemoteWorkgroupCatalog();
    return {
      success: response.success !== false,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle("save-workgroup-member", (_event, data: {
  id?: string;
  workgroupId: string;
  name: string;
  role: WorkgroupRole;
  projectId?: string | null;
  allowedPaths?: string[] | null;
  systemPrompt?: string | null;
}) => {
  const workgroup = workgroupStore.getWorkgroupById(data?.workgroupId || "");
  if (!workgroup) {
    return { success: false, error: "Workgroup not found" };
  }

  const name = String(data?.name ?? "").trim();
  if (!name) {
    return { success: false, error: "Member name is required" };
  }

  const projectId = typeof data?.projectId === "string" && data.projectId.trim() ? data.projectId.trim() : null;
  const binding = resolveWorkgroupProjectBinding(projectId);
  const member = workgroupStore.saveMember({
    id: typeof data?.id === "string" ? data.id.trim() : undefined,
    workgroupId: workgroup.id,
    name,
    role: data.role,
    projectId,
    projectName: binding.projectName,
    projectPath: binding.projectPath,
    projectKind: binding.projectKind,
    allowedPaths: Array.isArray(data?.allowedPaths) ? data.allowedPaths : [],
    systemPrompt: data?.systemPrompt ?? null,
  });
  touchWorkgroup(workgroup.id);
  broadcastWorkgroupsChanged();
  return {
    success: true,
    member: serializeWorkgroupMember(member),
    workgroup: getSerializedWorkgroupById(workgroup.id),
  };
});

ipcMain.handle("delete-workgroup-member", (_event, memberId: string) => {
  const member = workgroupStore.getMemberById(memberId);
  if (!member) {
    return { success: false, error: "Member not found" };
  }

  workgroupStore.removeMember(memberId);
  touchWorkgroup(member.workgroupId);
  broadcastWorkgroupsChanged();
  return { success: true };
});

ipcMain.handle("save-workgroup-task", (_event, data: {
  id?: string;
  workgroupId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  assigneeMemberId?: string | null;
  priority?: "low" | "normal" | "high";
  status?: WorkgroupTaskStatus;
}) => {
  const workgroup = workgroupStore.getWorkgroupById(data?.workgroupId || "");
  if (!workgroup) {
    return { success: false, error: "Workgroup not found" };
  }

  const title = String(data?.title ?? "").trim();
  if (!title) {
    return { success: false, error: "Task title is required" };
  }

  const assigneeMemberId = typeof data?.assigneeMemberId === "string" && data.assigneeMemberId.trim()
    ? data.assigneeMemberId.trim()
    : null;
  if (assigneeMemberId) {
    const member = workgroupStore.getMemberById(assigneeMemberId);
    if (!member || member.workgroupId !== workgroup.id) {
      return { success: false, error: "Assignee not found in this workgroup" };
    }
  }

  const task = workgroupStore.saveTask({
    id: typeof data?.id === "string" ? data.id.trim() : undefined,
    workgroupId: workgroup.id,
    title,
    description: data?.description ?? null,
    acceptanceCriteria: data?.acceptanceCriteria ?? null,
    assigneeMemberId,
    priority: data?.priority,
    status: data?.status,
  });
  touchWorkgroup(workgroup.id);
  broadcastWorkgroupsChanged();
  return {
    success: true,
    task,
    workgroup: getSerializedWorkgroupById(workgroup.id),
  };
});

ipcMain.handle("delete-workgroup-task", (_event, taskId: string) => {
  const task = workgroupStore.getTaskById(taskId);
  if (!task) {
    return { success: false, error: "Task not found" };
  }

  workgroupStore.removeTask(taskId);
  touchWorkgroup(task.workgroupId);
  broadcastWorkgroupsChanged();
  return { success: true };
});

ipcMain.handle("update-workgroup-task-status", (_event, data: {
  taskId: string;
  status: WorkgroupTaskStatus;
  lastDispatchResult?: string | null;
}) => handleUpdateWorkgroupTaskStatusRequest(data));

ipcMain.handle("dispatch-workgroup-task", async (_event, taskId: string) => handleDispatchWorkgroupTaskRequest(taskId));

ipcMain.on("minimize-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on("maximize-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.on("close-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

app.whenReady().then(async () => {
  tray = createTray();
  await refreshAgentToken(false);
  await refreshControllerToken(false);
  const config = loadConfig();
  initRelay(config);
  ensureRemoteRelayReady(config);
  scheduleTokenRefresh();
  scheduleControllerTokenRefresh();
  updateManager.start();

  // Open workspace window unless silent launch is configured
  const silentLaunch = appSettingsStore.get("silentLaunch") as boolean;
  const launchedFromUpdate = process.argv.some((entry) => entry === "--updated");
  if (launchedFromUpdate || !silentLaunch) {
    showWorkspaceWindow(projectStore.getAll()[0]?.id);
  }
});

app.on("window-all-closed", (_event: Electron.Event) => {
  // Keep running in system tray — do not quit when all windows close
  _event.preventDefault();
});

app.on("before-quit", () => {
  if (tokenRefreshTimer) {
    clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }
  if (controllerTokenRefreshTimer) {
    clearTimeout(controllerTokenRefreshTimer);
    controllerTokenRefreshTimer = null;
  }
  if (relayClient) relayClient.disconnect();
  if (controllerRelayClient) controllerRelayClient.disconnect();
  updateManager.stop();
  runtimeManager.dispose();
  for (const project of projectStore.getAll()) {
    ptyManager.kill(project.id);
  }
});
