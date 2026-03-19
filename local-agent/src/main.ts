import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } from "electron";
import * as path from "path";
import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";
import { createAppIcon, createTrayIcon } from "./app-icon";
import RelayClient from "./relay-client";
import MessageRouter from "./message-router";
import projectStore, { Project } from "./project-store";
import ptyManager from "./pty-manager";
import RuntimeManager, { CliProvider, ProjectSessionSnapshot } from "./runtime-manager";
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
  },
});

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let workspaceWindow: BrowserWindow | null = null;
let activeWorkspaceProjectId: string | null = null;
let relayClient: RelayClient | null = null;

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

runtimeManager.on("snapshot", (projectId: string, snapshot: ProjectSessionSnapshot) => {
  if (workspaceWindow && !workspaceWindow.isDestroyed()) {
    workspaceWindow.webContents.send("project-session-snapshot", snapshot);
  }
  broadcastSessionSync(snapshot);
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

  // Mobile already receives remote-triggered assistant output as streamed chunks.
  // Reserve full session sync for desktop-originated activity and final reconciliation.
  if (snapshot.isRunning && snapshot.currentSource !== "desktop") {
    return;
  }

  relayClient.send({
    id: uuidv4(),
    event: Events.SESSION_SYNC,
    project_id: snapshot.projectId,
    ts: Date.now(),
    payload: {
      project_id: snapshot.projectId,
      provider: snapshot.provider,
      model: snapshot.model,
      messages: snapshot.messages,
      activities: snapshot.activities,
    },
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

  relayClient = new RelayClient(config.serverUrl, config.agentId, config.token);
  new MessageRouter(relayClient, {
    revealProjectWindow: (projectId: string) => showWorkspaceWindow(projectId),
    runtimeManager,
    getDefaultCliProvider,
    onProjectsChanged: () => {
      rebuildTrayMenu();
      broadcastProjectsChanged();
      updateWindowTitles();
    },
  });

  relayClient.on("connected", () => {
    console.log("[Main] Relay connected");
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
    enabled: relayClient?.isE2EEnabled() ?? false,
    publicKey: relayClient?.getE2E().getPublicKey() ?? "",
  };
});

ipcMain.handle("set-e2e-enabled", (_event, enabled: boolean) => {
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
  return true;
});

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

ipcMain.handle("send-project-prompt", (_event, data: { projectId: string; prompt: string }) => {
  const project = projectStore.getById(data.projectId);
  if (!project) {
    return { success: false, error: "Project not found" };
  }

  runtimeManager.enqueueMessage({
    projectId: project.id,
    cwd: project.path,
    prompt: data.prompt,
    source: "desktop",
  });

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
  runtimeManager.dispose();
  for (const project of projectStore.getAll()) {
    ptyManager.kill(project.id);
  }
});
