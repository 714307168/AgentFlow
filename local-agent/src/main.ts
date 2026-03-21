import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } from "electron";
import "./user-data-bootstrap";
import * as fs from "fs";
import * as path from "path";
import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";
import { createAppIcon, createTrayIcon } from "./app-icon";
import appLogger from "./app-logger";
import RelayClient from "./relay-client";
import MessageRouter from "./message-router";
import projectStore, { Project } from "./project-store";
import ptyManager from "./pty-manager";
import RuntimeManager, { CliProvider, ProjectSessionSnapshot, RunAttachment } from "./runtime-manager";
import { buildSessionSyncPayload } from "./session-sync-payload";
import UpdateManager, { UpdateState } from "./update-manager";
import { Events } from "./types";
import { t, getLang, setLang, getAllMessages, Lang } from "./i18n";

interface AgentConfig {
  serverUrl: string;
  agentId: string;
  token: string;
  username?: string;
  cliProvider: CliProvider;
}

interface AppSettings {
  autoStart: boolean;
  silentLaunch: boolean;
  saveLogs: boolean;
  e2eEnabled: boolean;
  autoUpdateCheck: boolean;
  autoUpdateDownload: boolean;
}

const configStore = new Store<AgentConfig>({
  defaults: {
    serverUrl: "ws://localhost:8080/ws",
    agentId: "",
    token: "",
    username: "",
    cliProvider: "claude",
  },
});

const appSettingsStore = new Store<AppSettings>({
  name: "app-settings",
  defaults: {
    autoStart: false,
    silentLaunch: false,
    saveLogs: false,
    e2eEnabled: false,
    autoUpdateCheck: true,
    autoUpdateDownload: false,
  },
});

appLogger.setEnabled(appSettingsStore.get("saveLogs") as boolean);
appLogger.installConsoleCapture();

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let workspaceWindow: BrowserWindow | null = null;
let activeWorkspaceProjectId: string | null = null;
let relayClient: RelayClient | null = null;
const lastBroadcastSyncSeqByProject = new Map<string, number>();
const updateManager = new UpdateManager({
  getServerUrl: () => loadConfig().serverUrl,
  getAutoCheckEnabled: () => appSettingsStore.get("autoUpdateCheck") as boolean,
  getAutoDownloadEnabled: () => appSettingsStore.get("autoUpdateDownload") as boolean,
  getParentWindow: () => workspaceWindow ?? mainWindow ?? null,
});

function isImageAttachment(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif", ".heic"].includes(extension);
}

function toRunAttachment(filePath: string): RunAttachment {
  const stats = fs.statSync(filePath);
  return {
    id: uuidv4(),
    name: path.basename(filePath),
    path: filePath,
    size: stats.isFile() ? stats.size : 0,
    kind: isImageAttachment(filePath) ? "image" : "file",
  };
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

      return {
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id : uuidv4(),
        name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : path.basename(filePath),
        path: filePath,
        size: Number.isFinite(entry.size) ? Math.max(0, Number(entry.size)) : stats.size,
        kind: entry.kind === "image" || isImageAttachment(filePath) ? "image" : "file",
      } satisfies RunAttachment;
    })
    .filter((entry): entry is RunAttachment => entry !== null);
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
  return model || null;
}

function buildProjectListPayload(agentId: string): {
  agent_id: string;
  projects: Array<{
    id: string;
    name: string;
    path: string;
    cli_provider: CliProvider;
    cli_model: string;
  }>;
} {
  return {
    agent_id: agentId,
    projects: projectStore.getAll().map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      cli_provider: project.cliProvider,
      cli_model: project.cliModel ?? "",
    })),
  };
}

const runtimeManager = new RuntimeManager(() => ({
  getProjectProvider: getProjectCliProvider,
  getProjectModel: getProjectCliModel,
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
}));

function getSettingsWindowTitle(): string {
  return t("settings.title");
}

function getWorkspaceWindowTitle(projectId?: string | null): string {
  if (!projectId) {
    return t("app.name");
  }

  const project = projectStore.getById(projectId);
  return project ? `${project.name} - ${t("app.name")}` : t("app.name");
}

function getLangPayload(): { lang: Lang; messages: Record<string, string> } {
  return {
    lang: getLang(),
    messages: getAllMessages(),
  };
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
    mainWindow.setTitle(getSettingsWindowTitle());
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

runtimeManager.on("snapshot", (projectId: string, snapshot: ProjectSessionSnapshot) => {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("project-session-snapshot", snapshot);
  }
  broadcastSessionSync(snapshot);
});

updateManager.on("state-changed", (state: UpdateState) => {
  broadcastUpdateState(state);
});

function broadcastProjectsChanged(): void {
  const projects = projectStore.getAll();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("projects-changed", projects);
  }

  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("projects-changed", projects);
  }
}

function broadcastProjectSnapshot(projectId: string): void {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("project-session-snapshot", runtimeManager.getSnapshot(projectId));
  }
}

function broadcastSessionSync(snapshot: ProjectSessionSnapshot): void {
  if (!relayClient || !relayClient.isConnected()) {
    return;
  }

  const afterSeq = lastBroadcastSyncSeqByProject.has(snapshot.projectId)
    ? (lastBroadcastSyncSeqByProject.get(snapshot.projectId) ?? 0)
    : 0;
  const delta = runtimeManager.buildSyncDelta(snapshot.projectId, afterSeq);
  const payload = buildSessionSyncPayload(snapshot, delta, afterSeq);
  lastBroadcastSyncSeqByProject.set(snapshot.projectId, delta.latestSeq);
  relayClient.send({
    id: uuidv4(),
    event: Events.SESSION_SYNC,
    project_id: snapshot.projectId,
    ts: Date.now(),
    payload,
  });
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
  return {
    serverUrl: (process.env.RELAY_SERVER_URL ?? configStore.get("serverUrl")) as string,
    agentId: (process.env.AGENT_ID ?? configStore.get("agentId")) as string,
    token: (process.env.AGENT_TOKEN ?? configStore.get("token")) as string,
    username: configStore.get("username") as string,
    cliProvider: ((process.env.CLI_PROVIDER ?? configStore.get("cliProvider")) as CliProvider) || "claude",
  };
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
    revealWindow(mainWindow);
    return;
  }
  mainWindow = new BrowserWindow({
    width: 800,
    height: 700,
    title: getSettingsWindowTitle(),
    icon: createAppIcon(256),
    frame: false,
    transparent: false,
    backgroundColor: '#0d1117',
    parent: parentWindow ?? undefined,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "..", "renderer", "settings.html"));
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("lang-changed", getLangPayload());
      mainWindow.webContents.send("update-state-changed", updateManager.getState());
    }
  });
  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      revealWindow(mainWindow);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createWorkspaceWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
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
  });

  win.loadFile(path.join(__dirname, "..", "..", "renderer", "index.html"));
  win.once("ready-to-show", () => {
    revealWindow(win);
  });

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("lang-changed", getLangPayload());
    win.webContents.send("update-state-changed", updateManager.getState());
    win.webContents.send("projects-changed", projectStore.getAll());
    for (const project of projectStore.getAll()) {
      win.webContents.send("project-session-snapshot", runtimeManager.getSnapshot(project.id));
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

function openSettingsWindow(): void {
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
      cli_provider: project.cliProvider,
      cli_model: project.cliModel ?? "",
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
    revealProjectWindow: (projectId: string) => showWorkspaceWindow(projectId),
    runtimeManager,
    getDefaultCliProvider,
    syncProjectCatalog: () => syncProjectCatalog(loadConfig().agentId),
    onProjectsChanged: () => {
      rebuildTrayMenu();
      broadcastProjectsChanged();
      updateWindowTitles();
    },
  });

  relayClient.on("connected", () => {
    console.log("[Main] Relay connected");
    lastBroadcastSyncSeqByProject.clear();
    for (const project of projectStore.getAll()) {
      lastBroadcastSyncSeqByProject.set(project.id, runtimeManager.getLatestSyncSeq(project.id));
    }
    updateTrayTooltip();
    syncProjectCatalog(config.agentId);
  });

  relayClient.on("disconnected", () => {
    console.log("[Main] Relay disconnected");
    updateTrayTooltip();
  });

  relayClient.on("error", (err: Error) => {
    console.error("[Main] Relay error:", err.message);
  });

  relayClient.connect();
}

// IPC handlers
ipcMain.handle("get-projects", () => projectStore.getAll());

ipcMain.handle("add-project", async (_event, data: { name: string; path: string; cliProvider?: CliProvider; cliModel?: string | null }) => {
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
    cliProvider,
    cliModel,
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
  (_event, data: { projectId: string; updates: Partial<Pick<Project, "name" | "path" | "cliProvider" | "cliModel">> }) => {
    const project = projectStore.getById(data.projectId);
    if (!project) {
      return { success: false, error: "Project not found" };
    }

    const nextUpdates: Partial<Project> = { ...data.updates };
    if (data.updates.cliProvider !== undefined) {
      nextUpdates.cliProvider = normalizeCliProvider(
        data.updates.cliProvider,
        normalizeCliProvider(project.cliProvider, getDefaultCliProvider()),
      );
    }
    if (data.updates.cliModel !== undefined) {
      nextUpdates.cliModel = data.updates.cliModel?.trim() ? data.updates.cliModel.trim() : null;
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
  lastBroadcastSyncSeqByProject.delete(projectId);

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

ipcMain.handle("get-config", () => loadConfig());

ipcMain.handle("save-config", (_event, config: Partial<AgentConfig>) => {
  if (config.serverUrl !== undefined) configStore.set("serverUrl", config.serverUrl);
  if (config.agentId !== undefined) configStore.set("agentId", config.agentId);
  if (config.token !== undefined) configStore.set("token", config.token);
  if (config.username !== undefined) configStore.set("username", config.username);
  if (config.cliProvider !== undefined) configStore.set("cliProvider", config.cliProvider);
  return true;
});

ipcMain.handle("login", async (_event, data: { username: string; password: string; agentId: string }) => {
  try {
    const config = loadConfig();
    const serverUrl = config.serverUrl.replace(/^ws/, "http").replace(/\/ws$/, "");

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

    const result = await response.json();

    // Save token and username
    configStore.set("token", result.token);
    configStore.set("username", data.username);

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
  return true;
});

ipcMain.handle("reconnect-relay", () => {
  if (relayClient) {
    relayClient.disconnect();
  }
  const config = loadConfig();
  initRelay(config);
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
  return {
    autoStart: appSettingsStore.get("autoStart") as boolean,
    silentLaunch: appSettingsStore.get("silentLaunch") as boolean,
    saveLogs: appSettingsStore.get("saveLogs") as boolean,
    e2eEnabled: appSettingsStore.get("e2eEnabled") as boolean,
    autoUpdateCheck: appSettingsStore.get("autoUpdateCheck") as boolean,
    autoUpdateDownload: appSettingsStore.get("autoUpdateDownload") as boolean,
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
  }
  if (settings.autoUpdateCheck !== undefined) {
    appSettingsStore.set("autoUpdateCheck", settings.autoUpdateCheck);
    updateManager.start();
  }
  if (settings.autoUpdateDownload !== undefined) {
    appSettingsStore.set("autoUpdateDownload", settings.autoUpdateDownload);
  }
  return true;
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
  const project = projectStore.getById(projectId);
  if (project) {
    showWorkspaceWindow(project.id);
    return { success: true };
  }
  return { success: false, error: "Project not found" };
});

ipcMain.on("open-settings-window", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  showMainWindow(senderWindow ?? workspaceWindow);
});

ipcMain.on("set-active-project", (_event, projectId: string | null) => {
  activeWorkspaceProjectId = projectId;
  updateWindowTitles();
});

ipcMain.handle("get-project-session", (_event, projectId: string) => {
  const project = projectStore.getById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  return {
    success: true,
    project,
    session: runtimeManager.getSnapshot(projectId),
  };
});

ipcMain.handle("pick-project-attachments", async (event, data: { projectId: string; kind: "image" | "file" }) => {
  const project = projectStore.getById(data.projectId);
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
    defaultPath: project.path,
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
    attachments: result.filePaths.map((filePath) => toRunAttachment(filePath)),
  };
});

ipcMain.handle("send-project-prompt", (_event, data: { projectId: string; prompt: string; attachments?: unknown[] }) => {
  const project = projectStore.getById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const attachments = normalizeIncomingAttachments(data.attachments);
  if (!data.prompt.trim() && attachments.length === 0) {
    return { success: false, error: "Prompt cannot be empty" };
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
  const project = projectStore.getById(projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
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
  const project = projectStore.getById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  const removed = runtimeManager.removeQueuedRun(data.projectId, data.runId);
  if (!removed) {
    return { success: false, error: "Queued item not found" };
  }

  return { success: true };
});

// 窗口控制
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

app.whenReady().then(() => {
  tray = createTray();
  const config = loadConfig();
  initRelay(config);
  updateManager.start();

  // Open workspace window unless silent launch is configured
  const silentLaunch = appSettingsStore.get("silentLaunch") as boolean;
  if (!silentLaunch) {
    showWorkspaceWindow(projectStore.getAll()[0]?.id);
  }
});

app.on("window-all-closed", (_event: Electron.Event) => {
  // Keep running in system tray — do not quit when all windows close
  _event.preventDefault();
});

app.on("before-quit", () => {
  if (relayClient) relayClient.disconnect();
  updateManager.stop();
  runtimeManager.dispose();
  for (const project of projectStore.getAll()) {
    ptyManager.kill(project.id);
  }
});
