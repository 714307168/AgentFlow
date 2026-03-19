type Lang = "en" | "zh";

interface LangPayload {
  lang: Lang;
  messages: Record<string, string>;
}

interface ClaudeAgentApi {
  getProjects: () => Promise<ProjectState[]>;
  onProjectsChanged?: (callback: (projects: ProjectState[]) => void) => void;
  onProjectSessionSnapshot: (callback: (snapshot: SessionSnapshot) => void) => void;
  getProjectSession: (projectId: string) => Promise<ProjectSessionResponse>;
  sendProjectPrompt: (data: { projectId: string; prompt: string }) => Promise<{ success: boolean; error?: string }>;
  removeQueuedProjectPrompt: (data: { projectId: string; runId: string }) => Promise<{ success: boolean; error?: string }>;
  onProjectId: (callback: (projectId: string) => void) => void;
  getLang?: () => Promise<Lang>;
  getI18nMessages?: () => Promise<Record<string, string>>;
  onLangChanged?: (callback: (payload: LangPayload) => void) => void;
  openSettingsWindow?: () => void;
  setActiveProject?: (projectId: string | null) => void;
  minimizeWindow?: () => void;
  maximizeWindow?: () => void;
  closeWindow?: () => void;
}

interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  provider?: "claude" | "codex" | null;
  source: "remote" | "desktop";
  createdAt: number;
  updatedAt: number;
  status: "streaming" | "done";
}

interface SessionActivity {
  id: string;
  kind: "status" | "thinking" | "tool" | "command" | "agent" | "error";
  title: string;
  detail: string;
  status: "pending" | "running" | "completed" | "error";
  createdAt: number;
  updatedAt: number;
}

interface QueuedRunItem {
  runId: string;
  prompt: string;
  source: "remote" | "desktop";
  queuedAt: number;
}

interface SessionSnapshot {
  projectId: string;
  provider: "claude" | "codex";
  model: string | null;
  automationMode: "full-auto";
  isRunning: boolean;
  queuedCount: number;
  currentSource: "remote" | "desktop" | null;
  currentPrompt?: string | null;
  currentStartedAt?: number | null;
  queue: QueuedRunItem[];
  messages: SessionMessage[];
  activities: SessionActivity[];
}

interface ProjectState {
  id: string;
  name: string;
  path: string;
  cliProvider: "claude" | "codex";
  cliModel?: string | null;
}

interface ProjectSessionResponse {
  success: boolean;
  error?: string;
  project?: ProjectState;
  session?: SessionSnapshot;
}

interface HintState {
  key?: string;
  fallback: string;
  vars?: Record<string, string>;
  text?: string;
  isError: boolean;
}

interface Window {
  claudeAgent: ClaudeAgentApi;
}

const api = window.claudeAgent;

const elements = {
  projectTitle: document.getElementById("projectTitle"),
  projectMeta: document.getElementById("projectMeta"),
  providerBadge: document.getElementById("providerBadge"),
  modelBadge: document.getElementById("modelBadge") as HTMLButtonElement | null,
  modeBadge: document.getElementById("modeBadge"),
  runState: document.getElementById("runState"),
  queuePanel: document.getElementById("queuePanel"),
  queueTitle: document.getElementById("queueTitle"),
  queueCount: document.getElementById("queueCount"),
  queueList: document.getElementById("queueList"),
  projectList: document.getElementById("projectList"),
  messages: document.getElementById("messages"),
  activityList: document.getElementById("activityList"),
  composerForm: document.getElementById("composerForm") as HTMLFormElement | null,
  composerInput: document.getElementById("composerInput") as HTMLTextAreaElement | null,
  composerHint: document.getElementById("composerHint"),
  sendBtn: document.getElementById("sendBtn") as HTMLButtonElement | null,
  openActivityBtn: document.getElementById("openActivityBtn") as HTMLButtonElement | null,
  closeActivityBtn: document.getElementById("closeActivityBtn") as HTMLButtonElement | null,
  activityModal: document.getElementById("activityModal"),
  activityModalBackdrop: document.getElementById("activityModalBackdrop"),
  projectsKicker: document.getElementById("projectsKicker"),
  projectsTitle: document.getElementById("projectsTitle"),
  projectsSubtitle: document.getElementById("projectsSubtitle"),
  conversationKicker: document.getElementById("conversationKicker"),
  sessionViewTitle: document.getElementById("sessionViewTitle"),
  composerLabel: document.getElementById("composerLabel"),
  activityKicker: document.getElementById("activityKicker"),
  executionTraceTitle: document.getElementById("executionTraceTitle"),
  activitySubtitle: document.getElementById("activitySubtitle"),
  settingsBtn: document.getElementById("settingsBtn") as HTMLButtonElement | null,
  minimizeBtn: document.getElementById("minimizeBtn"),
  maximizeBtn: document.getElementById("maximizeBtn"),
  closeBtn: document.getElementById("closeBtn"),
};

const state: {
  projectId: string | null;
  projects: ProjectState[];
  sessionsByProjectId: Map<string, SessionSnapshot>;
  lang: Lang;
  messages: Record<string, string>;
  activityModalOpen: boolean;
  hint: HintState;
} = {
  projectId: null,
  projects: [],
  sessionsByProjectId: new Map<string, SessionSnapshot>(),
  lang: "en",
  messages: {},
  activityModalOpen: false,
  hint: {
    key: "terminal.hint.default",
    fallback: "Full-auto mode is enabled for both providers. Press Enter to send, Shift+Enter for a new line, and use /help to see slash-command support.",
    isError: false,
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTemplate(template: string, vars?: Record<string, string>): string {
  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_match, key: string) => vars[key] ?? "");
}

function msg(key: string, fallback: string, vars?: Record<string, string>): string {
  return formatTemplate(state.messages[key] ?? fallback, vars);
}

function inlineText(en: string, zh: string): string {
  return state.lang === "zh" ? zh : en;
}

function getLocale(): string {
  return state.lang === "zh" ? "zh-CN" : "en-US";
}

function providerLabel(provider: "claude" | "codex"): string {
  return provider === "codex" ? "OpenAI Codex" : "Claude Code";
}

function modelLabel(model: string | null | undefined): string {
  const value = model?.trim() ?? "";
  return value || inlineText("Auto", "自动");
}

function translateSource(source: "remote" | "desktop"): string {
  return source === "remote"
    ? msg("terminal.source.remote", "remote")
    : msg("terminal.source.desktop", "desktop");
}

function translateRole(role: SessionMessage["role"]): string {
  const fallbackMap: Record<SessionMessage["role"], string> = {
    user: "User",
    assistant: "Assistant",
    error: "Error",
  };
  return msg(`terminal.role.${role}`, fallbackMap[role]);
}

function translateKind(kind: SessionActivity["kind"]): string {
  const fallbackMap: Record<SessionActivity["kind"], string> = {
    status: "Status",
    thinking: "Thinking",
    tool: "Tool",
    command: "Command",
    agent: "Agent",
    error: "Error",
  };
  return msg(`terminal.kind.${kind}`, fallbackMap[kind]);
}

function translateActivityStatus(status: SessionActivity["status"]): string {
  const fallbackMap: Record<SessionActivity["status"], string> = {
    pending: "Pending",
    running: "Running",
    completed: "Completed",
    error: "Error",
  };
  return msg(`terminal.state.${status}`, fallbackMap[status]);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(getLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEmptyState(title: string, detail: string): string {
  return [
    '<div class="empty-state">',
    `<strong>${escapeHtml(title)}</strong>`,
    `<span>${escapeHtml(detail)}</span>`,
    "</div>",
  ].join("");
}

function queuePreview(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length <= 240) {
    return trimmed;
  }
  return `${trimmed.slice(0, 237)}...`;
}

function getCurrentProject(): ProjectState | null {
  return state.projects.find((project) => project.id === state.projectId) ?? null;
}

function getCurrentSession(): SessionSnapshot | null {
  if (!state.projectId) {
    return null;
  }

  return state.sessionsByProjectId.get(state.projectId) ?? null;
}

function getLatestActivity(session: SessionSnapshot | null): SessionActivity | null {
  if (!session || session.activities.length === 0) {
    return null;
  }

  return session.activities[session.activities.length - 1] ?? null;
}

function getConfiguredProvider(project: ProjectState | null, session: SessionSnapshot | null): "claude" | "codex" {
  if (session?.isRunning) {
    return session.provider;
  }
  return project?.cliProvider ?? session?.provider ?? "claude";
}

function getConfiguredModel(project: ProjectState | null, session: SessionSnapshot | null): string | null {
  if (session?.isRunning) {
    return session.model;
  }
  return project?.cliModel ?? session?.model ?? null;
}

function formatProjectSummary(
  provider: "claude" | "codex",
  model: string | null | undefined,
  detail: string,
): string {
  return `${providerLabel(provider)} · ${modelLabel(model)} · ${detail}`;
}

function getProjectStatusMeta(projectId: string): { label: string; tone: string; detail: string } {
  const project = state.projects.find((entry) => entry.id === projectId) ?? null;
  const session = state.sessionsByProjectId.get(projectId) ?? null;
  const configuredProvider = getConfiguredProvider(project, session);
  const configuredModel = getConfiguredModel(project, session);
  if (!session) {
    return {
      label: msg("terminal.project.status.idle", "Idle"),
      tone: "idle",
      detail: formatProjectSummary(configuredProvider, configuredModel, msg("terminal.project.summary.empty", "No messages yet")),
    };
  }

  const source = session.currentSource === "remote" ? "remote" : "desktop";
  if (session.isRunning) {
    return {
      label: msg("terminal.project.status.running", "Running"),
      tone: "running",
      detail: formatProjectSummary(
        session.provider,
        session.model,
        msg("terminal.project.summary.running", "Active via {source}", {
          source: translateSource(source),
        }),
      ),
    };
  }

  if (session.queuedCount > 0) {
    return {
      label: msg("terminal.project.status.queued", "Queued"),
      tone: "queued",
      detail: formatProjectSummary(
        configuredProvider,
        configuredModel,
        msg("terminal.project.summary.queued", "{count} queued", {
          count: String(session.queuedCount),
        }),
      ),
    };
  }

  const latestActivity = getLatestActivity(session);
  if (latestActivity?.status === "error") {
    return {
      label: msg("terminal.project.status.error", "Error"),
      tone: "error",
      detail: formatProjectSummary(
        configuredProvider,
        configuredModel,
        latestActivity.title || latestActivity.detail || msg("terminal.project.summary.error", "Latest run failed"),
      ),
    };
  }

  if (session.messages.length > 0) {
    return {
      label: msg("terminal.project.status.ready", "Ready"),
      tone: "ready",
      detail: formatProjectSummary(
        configuredProvider,
        configuredModel,
        msg("terminal.project.summary.ready", "Ready for the next prompt"),
      ),
    };
  }

  return {
    label: msg("terminal.project.status.idle", "Idle"),
    tone: "idle",
    detail: formatProjectSummary(configuredProvider, configuredModel, msg("terminal.project.summary.empty", "No messages yet")),
  };
}

function setActiveProject(projectId: string | null): void {
  state.projectId = projectId;
  if (!projectId) {
    state.activityModalOpen = false;
  }
  api.setActiveProject?.(projectId);
}

function updateDocumentTitle(): void {
  const project = getCurrentProject();
  if (project) {
    document.title = `${project.name} - ${msg("terminal.sessionSuffix", "Session")}`;
    return;
  }

  document.title = msg("terminal.defaultTitle", "Project Session");
}

function resolveHintText(): string {
  if (state.hint.text !== undefined) {
    return state.hint.text;
  }

  if (state.hint.key) {
    return msg(state.hint.key, state.hint.fallback, state.hint.vars);
  }

  return state.hint.fallback;
}

function renderHint(): void {
  if (!elements.composerHint) {
    return;
  }

  elements.composerHint.textContent = resolveHintText();
  elements.composerHint.style.color = state.hint.isError ? "var(--danger)" : "";
}

function setHintMessage(
  key: string,
  fallback: string,
  vars?: Record<string, string>,
  isError = false,
): void {
  state.hint = { key, fallback, vars, isError };
  renderHint();
}

function setHintText(text: string, isError: boolean): void {
  state.hint = { text, fallback: text, isError };
  renderHint();
}

function applyStaticI18n(): void {
  document.documentElement.lang = state.lang;

  if (elements.projectsKicker) {
    elements.projectsKicker.textContent = msg("terminal.panel.projects", "Projects");
  }
  if (elements.projectsTitle) {
    elements.projectsTitle.textContent = msg("terminal.panel.projectsTitle", "Project sessions");
  }
  if (elements.projectsSubtitle) {
    elements.projectsSubtitle.textContent = msg(
      "terminal.panel.projectsSubtitle",
      "Choose a project to view conversation and runtime status.",
    );
  }
  if (elements.conversationKicker) {
    elements.conversationKicker.textContent = msg("terminal.panel.conversation", "Conversation");
  }
  if (elements.sessionViewTitle) {
    elements.sessionViewTitle.textContent = msg("terminal.panel.sessionView", "Structured session view");
  }
  if (elements.openActivityBtn) {
    elements.openActivityBtn.textContent = msg("terminal.action.viewActivity", "View activity");
  }
  if (elements.queueTitle) {
    elements.queueTitle.textContent = inlineText("Queued prompts", "Queue");
  }
  if (elements.closeActivityBtn) {
    elements.closeActivityBtn.textContent = msg("terminal.action.close", "Close");
  }
  if (elements.composerLabel) {
    elements.composerLabel.textContent = msg("terminal.promptLabel", "Prompt");
  }
  if (elements.composerInput) {
    elements.composerInput.placeholder = msg(
      "terminal.promptPlaceholder",
      "Ask Claude Code or OpenAI Codex to inspect, edit, review, or debug this project.",
    );
  }
  if (elements.sendBtn) {
    elements.sendBtn.textContent = msg("terminal.action.send", "Send");
  }
  if (elements.activityKicker) {
    elements.activityKicker.textContent = msg("terminal.panel.activity", "Activity");
  }
  if (elements.executionTraceTitle) {
    elements.executionTraceTitle.textContent = msg("terminal.panel.executionTrace", "Execution trace");
  }
  if (elements.activitySubtitle) {
    elements.activitySubtitle.textContent = msg(
      "terminal.panel.activitySubtitle",
      "Thinking, tools, commands, and runtime status.",
    );
  }
  if (elements.minimizeBtn) {
    elements.minimizeBtn.title = msg("common.minimize", "Minimize");
  }
  if (elements.maximizeBtn) {
    elements.maximizeBtn.title = msg("common.maximize", "Maximize");
  }
  if (elements.settingsBtn) {
    const settingsLabel = msg("tray.settings", "Settings");
    elements.settingsBtn.textContent = settingsLabel;
    elements.settingsBtn.title = settingsLabel;
  }
  if (elements.closeBtn) {
    elements.closeBtn.title = msg("common.close", "Close");
  }
}

function renderQueue(): void {
  if (!elements.queuePanel || !elements.queueList || !elements.queueCount) {
    return;
  }

  const session = getCurrentSession();
  const queuedItems = session?.queue ?? [];
  const visible = queuedItems.length > 0;

  elements.queuePanel.classList.toggle("hidden", !visible);
  elements.queueCount.textContent = String(queuedItems.length);

  if (!visible) {
    elements.queueList.innerHTML = "";
    return;
  }

  elements.queueList.innerHTML = queuedItems
    .map((item, index) => [
      `<article class="queue-item" data-queue-run-id="${escapeHtml(item.runId)}">`,
      '<div class="queue-item-copy">',
      '<div class="queue-item-meta">',
      `<span class="queue-order">#${index + 1}</span>`,
      `<span class="queue-source">${escapeHtml(translateSource(item.source))}</span>`,
      `<span class="message-time">${escapeHtml(formatTime(item.queuedAt))}</span>`,
      "</div>",
      `<div class="queue-text">${escapeHtml(queuePreview(item.prompt))}</div>`,
      "</div>",
      `<button class="queue-remove" type="button" data-queue-remove="${escapeHtml(item.runId)}">${escapeHtml(inlineText("Remove", "Remove"))}</button>`,
      "</article>",
    ].join(""))
    .join("");
}

function renderProjectList(): void {
  if (!elements.projectList) {
    return;
  }

  if (state.projects.length === 0) {
    elements.projectList.innerHTML = formatEmptyState(
      msg("terminal.empty.projectsTitle", "No projects yet"),
      msg("terminal.empty.projectsDetail", "Add a project in settings, then return here."),
    );
    return;
  }

  elements.projectList.innerHTML = state.projects
    .map((project) => {
      const status = getProjectStatusMeta(project.id);
      const isSelected = project.id === state.projectId;
      return [
        `<button class="project-list-item${isSelected ? " selected" : ""}" type="button" data-project-id="${escapeHtml(project.id)}">`,
        '<div class="project-list-top">',
        `<span class="project-list-name">${escapeHtml(project.name)}</span>`,
        `<span class="project-status-pill ${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>`,
        "</div>",
        `<div class="project-list-detail">${escapeHtml(status.detail)}</div>`,
        `<div class="project-list-path">${escapeHtml(project.path)}</div>`,
        "</button>",
      ].join("");
    })
    .join("");
}

function renderMessages(): void {
  if (!elements.messages) {
    return;
  }

  const project = getCurrentProject();
  const session = getCurrentSession();

  if (!project) {
    elements.messages.innerHTML = formatEmptyState(
      msg("terminal.empty.selectProjectTitle", "No project selected"),
      msg("terminal.empty.selectProjectDetail", "Choose a project from the left sidebar to view messages."),
    );
    return;
  }

  if (!session || session.messages.length === 0) {
    elements.messages.innerHTML = formatEmptyState(
      msg("terminal.empty.messagesTitle", "No conversation yet"),
      msg(
        "terminal.empty.messagesDetail",
        "Incoming remote prompts and local desktop prompts will appear here as clean message cards.",
      ),
    );
    return;
  }

  const stickToBottom =
    elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < 80;

  elements.messages.innerHTML = session.messages
    .map((message) => {
      const sourceBadge = message.role === "user"
        ? translateSource(message.source)
        : providerLabel(message.provider ?? session.provider);

      return [
        `<article class="message-card ${escapeHtml(message.role)}">`,
        '<div class="message-shell">',
        '<div class="message-meta">',
        `<span class="role-badge ${escapeHtml(message.role)}">${escapeHtml(translateRole(message.role))}</span>`,
        `<span class="source-badge">${escapeHtml(sourceBadge)}</span>`,
        `<span class="message-time">${escapeHtml(formatTime(message.updatedAt || message.createdAt))}</span>`,
        "</div>",
        `<div class="message-content${message.status === "streaming" ? " streaming" : ""}">${escapeHtml(message.content)}</div>`,
        "</div>",
        "</article>",
      ].join("");
    })
    .join("");

  if (stickToBottom) {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }
}

function renderActivities(): void {
  if (!elements.activityList) {
    return;
  }

  const session = getCurrentSession();

  if (!state.projectId) {
    elements.activityList.innerHTML = formatEmptyState(
      msg("terminal.empty.selectProjectTitle", "No project selected"),
      msg("terminal.empty.selectProjectDetail", "Choose a project from the left sidebar to view messages."),
    );
    return;
  }

  if (!session || session.activities.length === 0) {
    elements.activityList.innerHTML = formatEmptyState(
      msg("terminal.empty.activitiesTitle", "No activity yet"),
      msg(
        "terminal.empty.activitiesDetail",
        "Tool calls, command executions, and thinking traces will be separated here instead of being mixed into one terminal stream.",
      ),
    );
    return;
  }

  elements.activityList.innerHTML = session.activities
    .slice()
    .reverse()
    .map((activity) => [
      '<article class="activity-card">',
      '<div class="activity-shell">',
      '<div class="activity-meta">',
      `<span class="kind-badge ${escapeHtml(activity.kind)}">${escapeHtml(translateKind(activity.kind))}</span>`,
      `<span class="status-badge ${escapeHtml(activity.status)}">${escapeHtml(translateActivityStatus(activity.status))}</span>`,
      `<span class="activity-time">${escapeHtml(formatTime(activity.updatedAt || activity.createdAt))}</span>`,
      "</div>",
      `<div class="activity-title">${escapeHtml(activity.title || msg("terminal.activity.fallbackTitle", "Activity"))}</div>`,
      `<div class="activity-detail">${escapeHtml(activity.detail)}</div>`,
      "</div>",
      "</article>",
    ].join(""))
    .join("");
}

function renderHeader(): void {
  const project = getCurrentProject();
  const session = getCurrentSession();
  const provider = getConfiguredProvider(project, session);
  const model = getConfiguredModel(project, session);
  const latestActivity = getLatestActivity(session);
  const source = session?.currentSource === "remote" ? "remote" : "desktop";

  if (elements.projectTitle) {
    elements.projectTitle.textContent = project?.name ?? msg("terminal.defaultTitle", "Project Session");
  }
  if (elements.projectMeta) {
    elements.projectMeta.textContent = project?.path ?? msg("terminal.waitingProjectContext", "Waiting for project context...");
  }
  if (elements.providerBadge) {
    elements.providerBadge.textContent = providerLabel(provider);
  }
  if (elements.modelBadge) {
    elements.modelBadge.textContent = `${inlineText("Model", "模型")}: ${modelLabel(model)}`;
    elements.modelBadge.title = inlineText("Switch model", "切换模型");
    elements.modelBadge.disabled = !project;
  }
  if (elements.modeBadge) {
    elements.modeBadge.textContent = msg("terminal.mode.fullAuto", "Full auto");
  }
  if (elements.runState) {
    if (!project) {
      elements.runState.textContent = msg(
        "terminal.empty.selectProjectDetail",
        "Choose a project from the left sidebar to view messages.",
      );
    } else if (!session) {
      elements.runState.textContent = msg("terminal.loadingSession", "Loading session...");
    } else if (session.isRunning) {
      elements.runState.textContent = msg(
        "terminal.runState.processing",
        "{provider} is processing a {source} prompt with full automation.",
        {
          provider: providerLabel(provider),
          source: translateSource(source),
        },
      );
    } else if (session.queuedCount > 0) {
      elements.runState.textContent = msg(
        "terminal.project.summary.queued",
        "{count} queued",
        { count: String(session.queuedCount) },
      );
    } else if (latestActivity?.status === "error") {
      elements.runState.textContent = msg(
        "terminal.runState.error",
        "Latest run failed: {detail}",
        {
          detail: latestActivity.title || latestActivity.detail || msg("terminal.project.summary.error", "Latest run failed"),
        },
      );
    } else {
      elements.runState.textContent = msg(
        "terminal.ready",
        "Ready. Send a prompt locally or wait for remote messages to arrive.",
      );
    }
  }
  if (elements.sendBtn) {
    elements.sendBtn.disabled = !state.projectId;
  }
  if (elements.openActivityBtn) {
    elements.openActivityBtn.toggleAttribute("disabled", !state.projectId);
  }

  updateDocumentTitle();
}

function renderActivityModal(): void {
  if (!elements.activityModal) {
    return;
  }

  elements.activityModal.classList.toggle("hidden", !state.activityModalOpen);
}

function render(): void {
  applyStaticI18n();
  renderProjectList();
  renderHeader();
  renderQueue();
  renderMessages();
  renderActivities();
  renderActivityModal();
  renderHint();
}

async function loadProjectSession(projectId: string): Promise<void> {
  const result = await api.getProjectSession(projectId);
  if (!result.success || !result.session) {
    return;
  }

  state.sessionsByProjectId.set(projectId, result.session);
}

async function syncProjects(projects?: ProjectState[]): Promise<void> {
  const nextProjects = projects ?? await api.getProjects();
  const projectIds = new Set(nextProjects.map((project) => project.id));

  state.projects = nextProjects;

  for (const projectId of Array.from(state.sessionsByProjectId.keys())) {
    if (!projectIds.has(projectId)) {
      state.sessionsByProjectId.delete(projectId);
    }
  }

  await Promise.all(
    nextProjects
      .filter((project) => !state.sessionsByProjectId.has(project.id))
      .map((project) => loadProjectSession(project.id)),
  );

  if (state.projectId && !projectIds.has(state.projectId)) {
    setActiveProject(nextProjects[0]?.id ?? null);
  }

  if (!state.projectId && nextProjects.length > 0) {
    setActiveProject(nextProjects[0].id);
  }

  render();
}

async function selectProject(projectId: string): Promise<void> {
  if (!state.projects.some((project) => project.id === projectId)) {
    return;
  }

  setActiveProject(projectId);
  if (!state.sessionsByProjectId.has(projectId)) {
    await loadProjectSession(projectId);
  }
  render();
}

async function submitPrompt(): Promise<void> {
  if (!state.projectId || !elements.composerInput) {
    return;
  }

  const prompt = elements.composerInput.value.trim();
  if (!prompt) {
    setHintMessage("terminal.hint.emptyPrompt", "Prompt cannot be empty.", undefined, true);
    return;
  }

  setHintMessage("terminal.hint.queued", "Queued for execution. Full-auto mode is active.");
  const result = await api.sendProjectPrompt({
    projectId: state.projectId,
    prompt,
  });

  if (!result.success) {
    setHintText(result.error ?? msg("terminal.error.sendPrompt", "Failed to send prompt"), true);
    return;
  }

  elements.composerInput.value = "";
  elements.composerInput.focus();
}

async function removeQueuedRun(runId: string): Promise<void> {
  if (!state.projectId) {
    return;
  }

  const result = await api.removeQueuedProjectPrompt({
    projectId: state.projectId,
    runId,
  });

  if (!result.success) {
    setHintText(result.error ?? inlineText("Failed to remove queued prompt", "Failed to remove queued prompt"), true);
    return;
  }

  setHintText(inlineText("Removed queued prompt.", "Removed queued prompt."), false);
}

async function promptForModel(): Promise<void> {
  const project = getCurrentProject();
  if (!project) {
    return;
  }

  const session = getCurrentSession();
  const currentModel = session?.model ?? project.cliModel ?? "";
  const nextModel = window.prompt(
    inlineText(
      "Enter a model name. Leave blank or type auto to use the provider default.",
      "输入模型名称。留空或输入 auto 使用 provider 默认模型。",
    ),
    currentModel,
  );

  if (nextModel === null) {
    return;
  }

  const normalized = nextModel.trim();
  const result = await api.sendProjectPrompt({
    projectId: project.id,
    prompt: normalized ? `/model ${normalized}` : "/model auto",
  });

  if (!result.success) {
    setHintText(result.error ?? inlineText("Failed to switch model", "模型切换失败"), true);
    return;
  }

  setHintText(inlineText("Model update queued.", "模型切换已入队。"), false);
  elements.composerInput?.focus();
}

async function loadI18n(): Promise<void> {
  try {
    const [lang, messages] = await Promise.all([
      api.getLang ? api.getLang() : Promise.resolve<Lang>("en"),
      api.getI18nMessages ? api.getI18nMessages() : Promise.resolve<Record<string, string>>({}),
    ]);

    state.lang = lang;
    state.messages = messages;
    render();
  } catch (error) {
    console.error("Failed to load i18n messages:", error);
  }
}

function openActivityModal(): void {
  if (!state.projectId) {
    return;
  }

  state.activityModalOpen = true;
  renderActivityModal();
}

function closeActivityModal(): void {
  state.activityModalOpen = false;
  renderActivityModal();
}

elements.composerForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitPrompt();
});

elements.composerInput?.addEventListener("keydown", (event) => {
  if (event.isComposing) {
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submitPrompt();
  }
});

elements.projectList?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const item = target?.closest("[data-project-id]") as HTMLElement | null;
  const projectId = item?.dataset.projectId;
  if (!projectId) {
    return;
  }

  void selectProject(projectId);
});

elements.queueList?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-queue-remove]") as HTMLElement | null;
  const runId = button?.dataset.queueRemove;
  if (!runId) {
    return;
  }

  void removeQueuedRun(runId);
});

elements.openActivityBtn?.addEventListener("click", () => {
  openActivityModal();
});

elements.closeActivityBtn?.addEventListener("click", () => {
  closeActivityModal();
});

elements.activityModalBackdrop?.addEventListener("click", () => {
  closeActivityModal();
});

elements.modelBadge?.addEventListener("click", () => {
  void promptForModel();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.activityModalOpen) {
    closeActivityModal();
  }
});

api.onProjectId((projectId) => {
  void selectProject(projectId);
});

api.onProjectSessionSnapshot((snapshot) => {
  state.sessionsByProjectId.set(snapshot.projectId, snapshot);
  render();
});

api.onProjectsChanged?.((projects) => {
  void syncProjects(projects);
});

api.onLangChanged?.((payload) => {
  state.lang = payload.lang;
  state.messages = payload.messages ?? {};
  render();
});

function bindClick(id: string, handler: () => void): void {
  const element = document.getElementById(id);
  element?.addEventListener("click", handler);
}

bindClick("minimizeBtn", () => api.minimizeWindow?.());
bindClick("maximizeBtn", () => api.maximizeWindow?.());
bindClick("settingsBtn", () => api.openSettingsWindow?.());
bindClick("closeBtn", () => {
  if (typeof api.closeWindow === "function") {
    api.closeWindow();
    return;
  }
  window.close();
});

void loadI18n();
void syncProjects();
render();
