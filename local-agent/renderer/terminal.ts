type Lang = "en" | "zh";
type WorkspaceView = "messages" | "activity" | "cli" | "queue";
type AttachmentKind = "image" | "file";

interface LangPayload {
  lang: Lang;
  messages: Record<string, string>;
}

interface AttachmentRef {
  id: string;
  name: string;
  path: string;
  size: number;
  kind: AttachmentKind;
  mimeType?: string;
  previewDataUrl?: string;
}

interface ClaudeAgentApi {
  getProjects: () => Promise<ProjectState[]>;
  onProjectsChanged?: (callback: (projects: ProjectState[]) => void) => void;
  onProjectSessionSnapshot: (callback: (snapshot: SessionSnapshot) => void) => void;
  getProjectSession: (projectId: string) => Promise<ProjectSessionResponse>;
  sendProjectPrompt: (data: { projectId: string; prompt: string; attachments?: AttachmentRef[] }) => Promise<{ success: boolean; error?: string }>;
  pickProjectAttachments?: (data: { projectId: string; kind: AttachmentKind }) => Promise<{
    success: boolean;
    error?: string;
    attachments?: AttachmentRef[];
  }>;
  saveClipboardProjectImage?: (data: { projectId: string }) => Promise<{
    success: boolean;
    error?: string;
    attachment?: AttachmentRef;
  }>;
  getAttachmentImageData?: (data: { path?: string | null }) => Promise<{
    success: boolean;
    error?: string;
    dataUrl?: string;
  }>;
  stopProjectRun: (projectId: string) => Promise<{ success: boolean; error?: string }>;
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
  attachments?: AttachmentRef[];
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

interface CliTraceEntry {
  id: string;
  stream: "system" | "stdout" | "stderr";
  text: string;
  createdAt: number;
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
  cliTrace: CliTraceEntry[];
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

interface OverviewState {
  tone: "idle" | "ready" | "running" | "queued" | "error";
  kicker: string;
  title: string;
  detail: string;
  source: string;
  signal: string;
}

interface AttachmentPreviewState {
  name: string;
  dataUrl: string;
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
  headerSummary: document.getElementById("headerSummary"),
  sessionOverview: document.getElementById("sessionOverview"),
  overviewLabel: document.getElementById("overviewLabel"),
  overviewTitle: document.getElementById("overviewTitle"),
  overviewDetail: document.getElementById("overviewDetail"),
  overviewQueueLabel: document.getElementById("overviewQueueLabel"),
  overviewQueueValue: document.getElementById("overviewQueueValue"),
  overviewSourceLabel: document.getElementById("overviewSourceLabel"),
  overviewSourceValue: document.getElementById("overviewSourceValue"),
  overviewSignalLabel: document.getElementById("overviewSignalLabel"),
  overviewSignalValue: document.getElementById("overviewSignalValue"),
  detailDock: document.getElementById("detailDock"),
  queuePanel: document.getElementById("queuePanel"),
  queueTitle: document.getElementById("queueTitle"),
  queueCount: document.getElementById("queueCount"),
  queueList: document.getElementById("queueList"),
  cliTitle: document.getElementById("cliTitle"),
  cliState: document.getElementById("cliState"),
  cliTrace: document.getElementById("cliTrace"),
  projectList: document.getElementById("projectList"),
  workbenchTabs: document.getElementById("workbenchTabs"),
  messagesTab: document.getElementById("messagesTab") as HTMLButtonElement | null,
  messagesTabLabel: document.getElementById("messagesTabLabel"),
  activityTab: document.getElementById("activityTab") as HTMLButtonElement | null,
  activityTabLabel: document.getElementById("activityTabLabel"),
  activityTabCount: document.getElementById("activityTabCount"),
  cliTab: document.getElementById("cliTab") as HTMLButtonElement | null,
  cliTabLabel: document.getElementById("cliTabLabel"),
  cliTabState: document.getElementById("cliTabState"),
  queueTab: document.getElementById("queueTab") as HTMLButtonElement | null,
  queueTabLabel: document.getElementById("queueTabLabel"),
  queueTabCount: document.getElementById("queueTabCount"),
  messagesView: document.getElementById("messagesView"),
  activityView: document.getElementById("activityView"),
  cliView: document.getElementById("cliView"),
  queueView: document.getElementById("queueView"),
  messages: document.getElementById("messages"),
  activityList: document.getElementById("activityList"),
  composerForm: document.getElementById("composerForm") as HTMLFormElement | null,
  composerInput: document.getElementById("composerInput") as HTMLTextAreaElement | null,
  composerHint: document.getElementById("composerHint"),
  attachImageBtn: document.getElementById("attachImageBtn") as HTMLButtonElement | null,
  attachFileBtn: document.getElementById("attachFileBtn") as HTMLButtonElement | null,
  attachmentTray: document.getElementById("attachmentTray"),
  stopBtn: document.getElementById("stopBtn") as HTMLButtonElement | null,
  sendBtn: document.getElementById("sendBtn") as HTMLButtonElement | null,
  projectsTitle: document.getElementById("projectsTitle"),
  sessionViewTitle: document.getElementById("sessionViewTitle"),
  composerLabel: document.getElementById("composerLabel"),
  settingsBtn: document.getElementById("settingsBtn") as HTMLButtonElement | null,
  minimizeBtn: document.getElementById("minimizeBtn"),
  maximizeBtn: document.getElementById("maximizeBtn"),
  closeBtn: document.getElementById("closeBtn"),
  attachmentLightbox: document.getElementById("attachmentLightbox"),
  attachmentLightboxImage: document.getElementById("attachmentLightboxImage") as HTMLImageElement | null,
  attachmentLightboxTitle: document.getElementById("attachmentLightboxTitle"),
  attachmentLightboxClose: document.getElementById("attachmentLightboxClose") as HTMLButtonElement | null,
};

const state: {
  projectId: string | null;
  projects: ProjectState[];
  sessionsByProjectId: Map<string, SessionSnapshot>;
  lang: Lang;
  messages: Record<string, string>;
  activeView: WorkspaceView;
  pendingAttachments: AttachmentRef[];
  preferredViews: Record<"claude" | "codex", WorkspaceView>;
  hint: HintState;
  attachmentPreview: AttachmentPreviewState | null;
} = {
  projectId: null,
  projects: [],
  sessionsByProjectId: new Map<string, SessionSnapshot>(),
  lang: "en",
  messages: {},
  activeView: "messages",
  pendingAttachments: [],
  preferredViews: {
    claude: "messages",
    codex: "cli",
  },
  hint: {
    key: "terminal.hint.default",
    fallback: "Press Enter to send, Shift+Enter for a new line. Conversation stays in front, with Activity, CLI, and Queue one tab away.",
    isError: false,
  },
  attachmentPreview: null,
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

function translateCliStream(stream: CliTraceEntry["stream"]): string {
  const labels: Record<CliTraceEntry["stream"], string> = {
    system: inlineText("System", "系统"),
    stdout: "stdout",
    stderr: "stderr",
  };
  return labels[stream];
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

function previewText(value: string | null | undefined, maxLength = 160): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function buildAttachmentOnlyPrompt(attachments: AttachmentRef[]): string {
  if (attachments.length === 1) {
    return attachments[0].kind === "image"
      ? inlineText(`Please inspect the attached image: ${attachments[0].name}`, `请查看我附上的图片：${attachments[0].name}`)
      : inlineText(`Please inspect the attached file: ${attachments[0].name}`, `请查看我附上的文件：${attachments[0].name}`);
  }

  return inlineText("Please inspect the attached files.", "请查看我附上的这些文件。");
}

function renderDockBlank(): string {
  return '<div class="dock-blank"></div>';
}

function mergeAttachments(current: AttachmentRef[], incoming: AttachmentRef[]): AttachmentRef[] {
  const merged = [...current];
  const existingPaths = new Set(current.map((attachment) => attachment.path));
  for (const attachment of incoming) {
    if (existingPaths.has(attachment.path)) {
      continue;
    }
    merged.push(attachment);
    existingPaths.add(attachment.path);
  }
  return merged;
}

function renderAttachmentCard(attachment: AttachmentRef): string {
  return [
    '<div class="attachment-card">',
    `<span class="attachment-kind ${escapeHtml(attachment.kind)}">${escapeHtml(attachment.kind === "image" ? inlineText("Image", "图片") : inlineText("File", "文件"))}</span>`,
    `<div class="attachment-name">${escapeHtml(attachment.name)}</div>`,
    `<div class="attachment-meta">${escapeHtml(formatFileSize(attachment.size))}</div>`,
    `<div class="attachment-meta">${escapeHtml(attachment.path)}</div>`,
    "</div>",
  ].join("");
}

function renderAttachmentChip(attachment: AttachmentRef): string {
  return [
    `<div class="attachment-chip" data-attachment-id="${escapeHtml(attachment.id)}">`,
    '<div class="attachment-copy">',
    `<span class="attachment-kind ${escapeHtml(attachment.kind)}">${escapeHtml(attachment.kind === "image" ? inlineText("Image", "图片") : inlineText("File", "文件"))}</span>`,
    `<div class="attachment-name">${escapeHtml(attachment.name)}</div>`,
    `<div class="attachment-meta">${escapeHtml(formatFileSize(attachment.size))} · ${escapeHtml(attachment.path)}</div>`,
    "</div>",
    `<button class="attachment-remove" type="button" data-remove-attachment="${escapeHtml(attachment.id)}">×</button>`,
    "</div>",
  ].join("");
}

function attachmentKindLabel(kind: AttachmentKind): string {
  return kind === "image" ? inlineText("Image", "图片") : inlineText("File", "文件");
}

function attachmentPreviewMarkup(attachment: AttachmentRef, className = "attachment-thumb"): string {
  if (attachment.kind !== "image" || !attachment.previewDataUrl) {
    return `<div class="${escapeHtml(className)} attachment-thumb-fallback">${escapeHtml(attachment.kind === "image" ? "IMG" : "FILE")}</div>`;
  }

  return `<img class="${escapeHtml(className)}" src="${escapeHtml(attachment.previewDataUrl)}" alt="${escapeHtml(attachment.name)}" loading="lazy" />`;
}

function renderAttachmentCardView(attachment: AttachmentRef): string {
  const label = attachmentKindLabel(attachment.kind);
  const metaParts = [formatFileSize(attachment.size)];
  if (attachment.mimeType) {
    metaParts.push(attachment.mimeType);
  }

  const content = [
    attachment.kind === "image"
      ? `<div class="attachment-preview-shell">${attachmentPreviewMarkup(attachment)}</div>`
      : "",
    '<div class="attachment-copy">',
    `<span class="attachment-kind ${escapeHtml(attachment.kind)}">${escapeHtml(label)}</span>`,
    `<div class="attachment-name">${escapeHtml(attachment.name)}</div>`,
    `<div class="attachment-meta">${escapeHtml(metaParts.join(" · "))}</div>`,
    `<div class="attachment-meta">${escapeHtml(attachment.path)}</div>`,
    "</div>",
  ].join("");

  if (attachment.kind === "image") {
    return [
      `<button class="attachment-card previewable" type="button" data-preview-attachment="${escapeHtml(attachment.id)}">`,
      content,
      "</button>",
    ].join("");
  }

  return [
    '<div class="attachment-card">',
    content,
    "</div>",
  ].join("");
}

function renderAttachmentChipView(attachment: AttachmentRef): string {
  const label = attachmentKindLabel(attachment.kind);
  return [
    `<div class="attachment-chip" data-attachment-id="${escapeHtml(attachment.id)}">`,
    attachment.kind === "image"
      ? `<button class="attachment-chip-preview" type="button" data-preview-attachment="${escapeHtml(attachment.id)}">${attachmentPreviewMarkup(attachment, "attachment-chip-thumb")}</button>`
      : "",
    '<div class="attachment-copy">',
    `<span class="attachment-kind ${escapeHtml(attachment.kind)}">${escapeHtml(label)}</span>`,
    `<div class="attachment-name">${escapeHtml(attachment.name)}</div>`,
    `<div class="attachment-meta">${escapeHtml(formatFileSize(attachment.size))} · ${escapeHtml(attachment.path)}</div>`,
    "</div>",
    `<button class="attachment-remove" type="button" data-remove-attachment="${escapeHtml(attachment.id)}">×</button>`,
    "</div>",
  ].join("");
}

function isWorkspaceView(value: string | undefined): value is WorkspaceView {
  return value === "messages" || value === "activity" || value === "cli" || value === "queue";
}

function defaultViewForProvider(provider: "claude" | "codex"): WorkspaceView {
  return provider === "codex" ? "cli" : "messages";
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

function getLatestCliEntry(session: SessionSnapshot | null): CliTraceEntry | null {
  if (!session || session.cliTrace.length === 0) {
    return null;
  }

  return session.cliTrace[session.cliTrace.length - 1] ?? null;
}

function getLatestMessage(session: SessionSnapshot | null): SessionMessage | null {
  if (!session || session.messages.length === 0) {
    return null;
  }

  return session.messages[session.messages.length - 1] ?? null;
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
  if (state.projectId !== projectId) {
    state.pendingAttachments = [];
    state.attachmentPreview = null;
  }
  state.projectId = projectId;
  api.setActiveProject?.(projectId);
}

function setActiveView(view: WorkspaceView, persistPreference = true): void {
  state.activeView = view;
  if (!persistPreference) {
    return;
  }

  const provider = getConfiguredProvider(getCurrentProject(), getCurrentSession());
  state.preferredViews[provider] = view;
}

function syncActiveViewForCurrentProject(): void {
  const provider = getConfiguredProvider(getCurrentProject(), getCurrentSession());
  state.activeView = state.preferredViews[provider] ?? defaultViewForProvider(provider);
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

function renderPendingAttachments(): void {
  if (!elements.attachmentTray) {
    return;
  }

  const hasItems = state.pendingAttachments.length > 0;
  elements.attachmentTray.classList.toggle("has-items", hasItems);
  elements.attachmentTray.innerHTML = hasItems
    ? state.pendingAttachments.map((attachment) => renderAttachmentChipView(attachment)).join("")
    : "";
}

function findAttachmentById(attachmentId: string): AttachmentRef | null {
  const pendingAttachment = state.pendingAttachments.find((attachment) => attachment.id === attachmentId);
  if (pendingAttachment) {
    return pendingAttachment;
  }

  const session = getCurrentSession();
  if (!session) {
    return null;
  }

  for (const message of session.messages) {
    const match = message.attachments?.find((attachment) => attachment.id === attachmentId);
    if (match) {
      return match;
    }
  }

  return null;
}

function renderAttachmentLightbox(): void {
  if (!elements.attachmentLightbox || !elements.attachmentLightboxImage || !elements.attachmentLightboxTitle) {
    return;
  }

  const preview = state.attachmentPreview;
  const isOpen = Boolean(preview);
  elements.attachmentLightbox.classList.toggle("hidden", !isOpen);
  document.body.classList.toggle("lightbox-open", isOpen);
  elements.attachmentLightboxImage.src = preview?.dataUrl ?? "";
  elements.attachmentLightboxImage.alt = preview?.name ?? "";
  elements.attachmentLightboxTitle.textContent = preview?.name ?? "";
}

async function openAttachmentPreview(attachmentId: string): Promise<void> {
  const attachment = findAttachmentById(attachmentId);
  if (!attachment || attachment.kind !== "image") {
    return;
  }

  let dataUrl = attachment.previewDataUrl?.trim() ?? "";
  if (!dataUrl && api.getAttachmentImageData) {
    const result = await api.getAttachmentImageData({ path: attachment.path });
    if (!result.success || !result.dataUrl) {
      setHintText(result.error ?? inlineText("Failed to load image preview.", "图片预览加载失败。"), true);
      return;
    }
    dataUrl = result.dataUrl;
  }

  if (!dataUrl) {
    setHintText(inlineText("Image preview is unavailable.", "当前图片无法预览。"), true);
    return;
  }

  state.attachmentPreview = {
    name: attachment.name,
    dataUrl,
  };
  renderAttachmentLightbox();
}

function closeAttachmentPreview(): void {
  if (!state.attachmentPreview) {
    return;
  }

  state.attachmentPreview = null;
  renderAttachmentLightbox();
}

async function saveClipboardImageAttachment(): Promise<void> {
  if (!state.projectId || !api.saveClipboardProjectImage) {
    return;
  }

  const result = await api.saveClipboardProjectImage({ projectId: state.projectId });
  if (!result.success || !result.attachment) {
    setHintText(result.error ?? inlineText("Failed to paste image from clipboard.", "粘贴剪贴板图片失败。"), true);
    return;
  }

  state.pendingAttachments = mergeAttachments(state.pendingAttachments, [result.attachment]);
  renderPendingAttachments();
  setHintText(
    inlineText(
      `${state.pendingAttachments.length} attachment(s) ready to send.`,
      `已添加 ${state.pendingAttachments.length} 个附件，发送时会一并带上。`,
    ),
    false,
  );
}

function applyStaticI18n(): void {
  document.documentElement.lang = state.lang;

  if (elements.projectsTitle) {
    elements.projectsTitle.textContent = msg("terminal.panel.projects", "Projects");
  }
  if (elements.messagesTabLabel) {
    elements.messagesTabLabel.textContent = inlineText("Conversation", "\u5bf9\u8bdd");
  }
  if (elements.activityTabLabel) {
    elements.activityTabLabel.textContent = inlineText("Activity", "\u6d3b\u52a8");
  }
  if (elements.cliTabLabel) {
    elements.cliTabLabel.textContent = "CLI";
  }
  if (elements.queueTabLabel) {
    elements.queueTabLabel.textContent = inlineText("Queue", "\u961f\u5217");
  }
  if (elements.overviewQueueLabel) {
    elements.overviewQueueLabel.textContent = inlineText("Queue", "\u961f\u5217");
  }
  if (elements.overviewSourceLabel) {
    elements.overviewSourceLabel.textContent = inlineText("Source", "\u6765\u6e90");
  }
  if (elements.overviewSignalLabel) {
    elements.overviewSignalLabel.textContent = inlineText("Latest", "\u6700\u65b0");
  }
  if (elements.queueTitle) {
    elements.queueTitle.textContent = inlineText("Queued prompts", "排队提示");
  }
  if (elements.cliTitle) {
    elements.cliTitle.textContent = inlineText("CLI stream", "CLI \u6267\u884c\u6d41");
  }
  if (elements.composerLabel) {
    elements.composerLabel.textContent = msg("terminal.promptLabel", "Prompt");
  }
  if (elements.attachImageBtn) {
    const label = inlineText("Image", "图片");
    elements.attachImageBtn.textContent = label;
    elements.attachImageBtn.title = label;
  }
  if (elements.attachFileBtn) {
    const label = inlineText("File", "文件");
    elements.attachFileBtn.textContent = label;
    elements.attachFileBtn.title = label;
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
  if (elements.stopBtn) {
    const stopLabel = inlineText("Terminate", "终止");
    elements.stopBtn.textContent = stopLabel;
    elements.stopBtn.title = stopLabel;
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

function buildOverviewState(
  project: ProjectState | null,
  session: SessionSnapshot | null,
  provider: "claude" | "codex",
): OverviewState {
  if (!project) {
    return {
      tone: "idle",
      kicker: inlineText("Workbench", "\u5de5\u4f5c\u53f0"),
      title: inlineText("Select a project to start", "\u9009\u62e9\u4e00\u4e2a\u9879\u76ee\u5f00\u59cb"),
      detail: inlineText(
        "Conversation stays in front. Activity, CLI, and Queue are organized as secondary views.",
        "\u5bf9\u8bdd\u4f18\u5148\u5c55\u793a\uff0c\u6d3b\u52a8\u3001CLI \u548c\u961f\u5217\u653e\u5728\u4e0b\u65b9\u5207\u6362\u533a\u3002",
      ),
      source: inlineText("Idle", "\u7a7a\u95f2"),
      signal: inlineText("Waiting", "\u7b49\u5f85"),
    };
  }

  if (!session) {
    return {
      tone: "idle",
      kicker: inlineText("Loading", "\u52a0\u8f7d\u4e2d"),
      title: inlineText("Loading session state", "\u6b63\u5728\u52a0\u8f7d\u4f1a\u8bdd\u72b6\u6001"),
      detail: inlineText(
        "Project context is ready. Recent messages and execution state will appear here shortly.",
        "\u9879\u76ee\u4e0a\u4e0b\u6587\u5df2\u5c31\u7eea\uff0c\u6700\u8fd1\u7684\u6d88\u606f\u4e0e\u6267\u884c\u72b6\u6001\u4f1a\u5f88\u5feb\u51fa\u73b0\u5728\u8fd9\u91cc\u3002",
      ),
      source: inlineText("Idle", "\u7a7a\u95f2"),
      signal: inlineText("Loading", "\u52a0\u8f7d"),
    };
  }

  const latestActivity = getLatestActivity(session);
  const latestCliEntry = getLatestCliEntry(session);
  const latestMessage = getLatestMessage(session);

  if (session.isRunning) {
    return {
      tone: "running",
      kicker: provider === "codex"
        ? inlineText("Executing now", "\u6b63\u5728\u6267\u884c")
        : inlineText("Working now", "\u6b63\u5728\u5904\u7406"),
      title: previewText(session.currentPrompt, 144) || inlineText("Current run in progress", "\u5f53\u524d\u4efb\u52a1\u6267\u884c\u4e2d"),
      detail: previewText(latestActivity?.detail || latestActivity?.title || latestCliEntry?.text, 180) || inlineText(
        "Live execution is updating below. Open Activity or CLI for full detail.",
        "\u4e0b\u65b9\u4f1a\u6301\u7eed\u66f4\u65b0\u6267\u884c\u7ec6\u8282\uff0c\u9700\u8981\u65f6\u53ef\u4ee5\u5207\u5230\u6d3b\u52a8\u6216 CLI \u67e5\u770b\u3002",
      ),
      source: translateSource(session.currentSource ?? "desktop"),
      signal: latestActivity
        ? translateKind(latestActivity.kind)
        : translateCliStream(latestCliEntry?.stream ?? "system"),
    };
  }

  if (latestActivity?.status === "error") {
    return {
      tone: "error",
      kicker: inlineText("Needs attention", "\u9700\u8981\u5173\u6ce8"),
      title: previewText(latestActivity.title || latestActivity.detail, 144) || inlineText(
        "The last run ended with an error",
        "\u4e0a\u6b21\u8fd0\u884c\u4ee5\u9519\u8bef\u7ed3\u675f",
      ),
      detail: previewText(latestActivity.detail, 180) || inlineText(
        "Open Activity or CLI to inspect the failure details.",
        "\u53ef\u4ee5\u6253\u5f00\u6d3b\u52a8\u6216 CLI \u67e5\u770b\u5931\u8d25\u539f\u56e0\u3002",
      ),
      source: providerLabel(provider),
      signal: translateActivityStatus("error"),
    };
  }

  if (session.queue.length > 0) {
    const nextItem = session.queue[0];
    return {
      tone: "queued",
      kicker: inlineText("Queued next", "\u4e0b\u4e00\u4e2a\u961f\u5217\u4efb\u52a1"),
      title: previewText(nextItem?.prompt, 144) || inlineText("Queued prompt", "\u5df2\u6392\u961f\u7684\u63d0\u793a"),
      detail: session.queuedCount > 1
        ? inlineText(
          `${session.queuedCount} prompts are waiting to run.`,
          `\u5171\u6709 ${session.queuedCount} \u6761\u63d0\u793a\u5728\u7b49\u5f85\u6267\u884c\u3002`,
        )
        : inlineText(
          "The next prompt is ready and waiting.",
          "\u4e0b\u4e00\u6761\u63d0\u793a\u5df2\u5728\u961f\u5217\u4e2d\u7b49\u5f85\u6267\u884c\u3002",
        ),
      source: translateSource(nextItem?.source ?? "desktop"),
      signal: msg("terminal.project.status.queued", "Queued"),
    };
  }

  if (latestMessage) {
    const latestSource = latestMessage.role === "user"
      ? translateSource(latestMessage.source)
      : providerLabel(latestMessage.provider ?? provider);
    return {
      tone: latestMessage.status === "streaming" ? "running" : "ready",
      kicker: latestMessage.role === "assistant"
        ? inlineText("Latest reply", "\u6700\u65b0\u56de\u590d")
        : inlineText("Latest message", "\u6700\u65b0\u6d88\u606f"),
      title: previewText(latestMessage.content, 144) || inlineText("Message ready", "\u6d88\u606f\u5df2\u5c31\u7eea"),
      detail: latestMessage.role === "user"
        ? inlineText("Awaiting the next assistant step.", "\u6b63\u5728\u7b49\u5f85\u4e0b\u4e00\u6b65\u56de\u5e94\u3002")
        : inlineText("Ready for the next prompt.", "\u5df2\u5c31\u7eea\uff0c\u53ef\u4ee5\u7ee7\u7eed\u53d1\u9001\u4e0b\u4e00\u6761\u63d0\u793a\u3002"),
      source: latestSource,
      signal: latestMessage.status === "streaming"
        ? msg("terminal.state.running", "Running")
        : msg("terminal.project.status.ready", "Ready"),
    };
  }

  return {
    tone: "ready",
    kicker: inlineText("Ready", "\u5c31\u7eea"),
    title: inlineText("Start the next prompt", "\u53ef\u4ee5\u5f00\u59cb\u4e0b\u4e00\u6761\u63d0\u793a"),
    detail: provider === "codex"
      ? inlineText(
        "Execution details remain close by in CLI and Activity when you need them.",
        "CLI \u4e0e\u6d3b\u52a8\u8be6\u60c5\u4ecd\u7136\u5728\u4e0b\u65b9\uff0c\u9700\u8981\u65f6\u53ef\u4ee5\u968f\u65f6\u5207\u6362\u3002",
      )
      : inlineText(
        "Stay in the conversation by default, then open CLI only when you need deeper execution detail.",
        "\u9ed8\u8ba4\u4ee5\u5bf9\u8bdd\u4e3a\u4e3b\uff0c\u9700\u8981\u66f4\u6df1\u6267\u884c\u7ec6\u8282\u65f6\u518d\u6253\u5f00 CLI\u3002",
      ),
    source: inlineText("Desktop", "\u684c\u9762\u7aef"),
    signal: msg("terminal.project.status.ready", "Ready"),
  };
}

function renderSessionOverview(): void {
  const project = getCurrentProject();
  const session = getCurrentSession();
  const provider = getConfiguredProvider(project, session);
  const overview = buildOverviewState(project, session, provider);

  if (elements.sessionOverview) {
    elements.sessionOverview.className = `session-overview ${overview.tone}`;
  }
  if (elements.overviewLabel) {
    elements.overviewLabel.textContent = overview.kicker;
  }
  if (elements.overviewTitle) {
    elements.overviewTitle.textContent = overview.title;
  }
  if (elements.overviewDetail) {
    elements.overviewDetail.textContent = overview.detail;
  }
  if (elements.overviewQueueValue) {
    elements.overviewQueueValue.textContent = String(session?.queuedCount ?? 0);
  }
  if (elements.overviewSourceValue) {
    elements.overviewSourceValue.textContent = overview.source;
  }
  if (elements.overviewSignalValue) {
    elements.overviewSignalValue.textContent = overview.signal;
  }
}

function renderWorkbench(): void {
  const session = getCurrentSession();
  const activityCount = session?.activities.length ?? 0;
  const queueCount = session?.queue.length ?? 0;
  const cliRunning = Boolean(session?.isRunning);
  const tabs: Array<{
    button: HTMLButtonElement | null;
    view: WorkspaceView;
  }> = [
    { button: elements.messagesTab, view: "messages" },
    { button: elements.activityTab, view: "activity" },
    { button: elements.cliTab, view: "cli" },
    { button: elements.queueTab, view: "queue" },
  ];
  const detailViews: Array<{ panel: HTMLElement | null; view: Exclude<WorkspaceView, "messages"> }> = [
    { panel: elements.activityView, view: "activity" },
    { panel: elements.cliView, view: "cli" },
    { panel: elements.queueView, view: "queue" },
  ];
  const showDock = Boolean(state.projectId) && state.activeView !== "messages";

  if (elements.activityTabCount) {
    elements.activityTabCount.textContent = String(activityCount);
    elements.activityTabCount.classList.toggle("quiet", activityCount === 0);
  }
  if (elements.queueTabCount) {
    elements.queueTabCount.textContent = String(queueCount);
    elements.queueTabCount.classList.toggle("quiet", queueCount === 0);
  }
  if (elements.cliTabState) {
    elements.cliTabState.textContent = cliRunning ? inlineText("Live", "\u5b9e\u65f6") : inlineText("Idle", "\u7a7a\u95f2");
    elements.cliTabState.dataset.tone = cliRunning ? "running" : "idle";
  }
  if (elements.detailDock) {
    elements.detailDock.classList.toggle("is-open", showDock);
  }

  tabs.forEach(({ button, view }) => {
    const isActive = state.activeView === view;
    button?.classList.toggle("active", isActive);
    button?.setAttribute("aria-pressed", String(isActive));
  });

  detailViews.forEach(({ panel, view }) => {
    panel?.classList.toggle("is-active", showDock && state.activeView === view);
  });
}

function renderQueue(): void {
  if (!elements.queueList || !elements.queueCount) {
    return;
  }

  const project = getCurrentProject();
  const session = getCurrentSession();
  const queuedItems = session?.queue ?? [];
  elements.queueCount.textContent = String(queuedItems.length);

  if (!project) {
    elements.queueList.innerHTML = formatEmptyState(
      msg("terminal.empty.selectProjectTitle", "No project selected"),
      msg("terminal.empty.selectProjectDetail", "Choose a project from the left sidebar to view messages."),
    );
    return;
  }

  if (queuedItems.length === 0) {
    elements.queueList.innerHTML = renderDockBlank();
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

function renderCliTrace(): void {
  if (!elements.cliTrace || !elements.cliState) {
    return;
  }

  const project = getCurrentProject();
  const session = getCurrentSession();

  elements.cliState.textContent = session?.isRunning
    ? inlineText("Running", "运行中")
    : inlineText("Idle", "空闲");
  elements.cliState.className = `project-status-pill ${session?.isRunning ? "running" : "idle"}`;

  if (!project) {
    elements.cliTrace.innerHTML = formatEmptyState(
      inlineText("No project selected", "未选择项目"),
      inlineText("Select a project to inspect the live CLI execution stream.", "选择一个项目后，这里会显示实时 CLI 执行流。"),
    );
    return;
  }

  const entries = session?.cliTrace ?? [];
  if (entries.length === 0) {
    elements.cliTrace.innerHTML = renderDockBlank();
    return;
  }

  const stickToBottom =
    elements.cliTrace.scrollHeight - elements.cliTrace.scrollTop - elements.cliTrace.clientHeight < 80;

  elements.cliTrace.innerHTML = entries
    .map((entry) => [
      `<article class="cli-line ${escapeHtml(entry.stream)}">`,
      '<div class="cli-line-meta">',
      `<span class="cli-stream-badge ${escapeHtml(entry.stream)}">${escapeHtml(translateCliStream(entry.stream))}</span>`,
      `<span class="activity-time">${escapeHtml(formatTime(entry.createdAt))}</span>`,
      "</div>",
      `<div class="cli-line-text">${escapeHtml(entry.text)}</div>`,
      "</article>",
    ].join(""))
    .join("");

  if (stickToBottom) {
    elements.cliTrace.scrollTop = elements.cliTrace.scrollHeight;
  }
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
        message.attachments && message.attachments.length > 0
          ? `<div class="message-attachments">${message.attachments.map((attachment) => renderAttachmentCardView(attachment)).join("")}</div>`
          : "",
        message.content
          ? `<div class="message-content${message.status === "streaming" ? " streaming" : ""}">${escapeHtml(message.content)}</div>`
          : "",
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
    elements.activityList.innerHTML = renderDockBlank();
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
  const statusMeta = project ? getProjectStatusMeta(project.id) : null;

  document.body.dataset.provider = provider;

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
  if (elements.sessionViewTitle) {
    elements.sessionViewTitle.textContent = project?.name ?? msg("terminal.projectFallback", "Project");
  }
  if (elements.headerSummary) {
    elements.headerSummary.textContent = statusMeta?.detail ?? msg("terminal.waitingProjectContext", "Waiting for project context...");
  }
  if (elements.runState) {
    if (!project) {
      elements.runState.textContent = inlineText("Unselected", "未选择");
      elements.runState.className = "project-status-pill idle";
    } else if (!session) {
      elements.runState.textContent = inlineText("Loading", "加载中");
      elements.runState.className = "project-status-pill idle";
    } else {
      elements.runState.textContent = statusMeta?.label ?? inlineText("Ready", "就绪");
      elements.runState.className = `project-status-pill ${statusMeta?.tone ?? "ready"}`;
    }
  }
  if (elements.sendBtn) {
    elements.sendBtn.disabled = !state.projectId;
  }
  if (elements.stopBtn) {
    elements.stopBtn.disabled = !session?.isRunning;
  }
  if (elements.attachImageBtn) {
    elements.attachImageBtn.disabled = !state.projectId;
  }
  if (elements.attachFileBtn) {
    elements.attachFileBtn.disabled = !state.projectId;
  }
  if (elements.activityTab) {
    elements.activityTab.disabled = !state.projectId;
  }
  if (elements.cliTab) {
    elements.cliTab.disabled = !state.projectId;
  }
  if (elements.queueTab) {
    elements.queueTab.disabled = !state.projectId;
  }

  updateDocumentTitle();
}

function render(): void {
  applyStaticI18n();
  renderProjectList();
  renderHeader();
  renderWorkbench();
  renderQueue();
  renderCliTrace();
  renderMessages();
  renderActivities();
  renderPendingAttachments();
  renderAttachmentLightbox();
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

  syncActiveViewForCurrentProject();
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
  syncActiveViewForCurrentProject();
  render();
}

async function pickAttachments(kind: AttachmentKind): Promise<void> {
  if (!state.projectId || !api.pickProjectAttachments) {
    return;
  }

  const result = await api.pickProjectAttachments({
    projectId: state.projectId,
    kind,
  });

  if (!result.success) {
    setHintText(result.error ?? inlineText("Failed to add attachments.", "添加附件失败。"), true);
    return;
  }

  const attachments = result.attachments ?? [];
  if (attachments.length === 0) {
    return;
  }

  state.pendingAttachments = mergeAttachments(state.pendingAttachments, attachments);
  renderPendingAttachments();
  setHintText(
    inlineText(
      `${state.pendingAttachments.length} attachment(s) ready to send.`,
      `已添加 ${state.pendingAttachments.length} 个附件，发送时会一并带上。`,
    ),
    false,
  );
}

function removePendingAttachment(attachmentId: string): void {
  state.pendingAttachments = state.pendingAttachments.filter((attachment) => attachment.id !== attachmentId);
  renderPendingAttachments();
}

async function submitPrompt(): Promise<void> {
  if (!state.projectId || !elements.composerInput) {
    return;
  }

  const rawPrompt = elements.composerInput.value.replace(/\r\n/g, "\n");
  const attachments = [...state.pendingAttachments];
  if (!rawPrompt.trim() && attachments.length === 0) {
    setHintMessage("terminal.hint.emptyPrompt", "Prompt cannot be empty.", undefined, true);
    return;
  }
  const prompt = rawPrompt.trim() ? rawPrompt : buildAttachmentOnlyPrompt(attachments);

  const session = getCurrentSession();
  setHintText(
    session?.isRunning
      ? inlineText("Queued behind the current run.", "已加入队列，将在当前任务结束后执行。")
      : msg("terminal.hint.queued", "Queued for execution. Full-auto mode is active."),
    false,
  );
  const result = await api.sendProjectPrompt({
    projectId: state.projectId,
    prompt,
    attachments,
  });

  if (!result.success) {
    setHintText(result.error ?? msg("terminal.error.sendPrompt", "Failed to send prompt"), true);
    return;
  }

  elements.composerInput.value = "";
  state.pendingAttachments = [];
  renderPendingAttachments();
  elements.composerInput.focus();
}

async function stopActiveRun(): Promise<void> {
  if (!state.projectId) {
    return;
  }

  const result = await api.stopProjectRun(state.projectId);
  if (!result.success) {
    setHintText(
      result.error ?? inlineText("Failed to stop the current run.", "终止当前任务失败。"),
      true,
    );
    return;
  }

  setHintText(
    inlineText("Stopping the current run.", "正在终止当前任务。"),
    false,
  );
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

elements.composerForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitPrompt();
});

elements.stopBtn?.addEventListener("click", () => {
  void stopActiveRun();
});

elements.attachImageBtn?.addEventListener("click", () => {
  void pickAttachments("image");
});

elements.attachFileBtn?.addEventListener("click", () => {
  void pickAttachments("file");
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

elements.composerInput?.addEventListener("paste", (event) => {
  const items = Array.from(event.clipboardData?.items ?? []);
  if (!items.some((item) => item.type.startsWith("image/"))) {
    return;
  }

  event.preventDefault();
  void saveClipboardImageAttachment();
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

elements.attachmentTray?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest("[data-remove-attachment]") as HTMLElement | null;
  const attachmentId = button?.dataset.removeAttachment;
  if (attachmentId) {
    removePendingAttachment(attachmentId);
    return;
  }

  const previewTrigger = target?.closest("[data-preview-attachment]") as HTMLElement | null;
  const previewAttachmentId = previewTrigger?.dataset.previewAttachment;
  if (!previewAttachmentId) {
    return;
  }

  void openAttachmentPreview(previewAttachmentId);
});

elements.messages?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const previewTrigger = target?.closest("[data-preview-attachment]") as HTMLElement | null;
  const attachmentId = previewTrigger?.dataset.previewAttachment;
  if (!attachmentId) {
    return;
  }

  void openAttachmentPreview(attachmentId);
});

elements.attachmentLightbox?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return;
  }
  if (target.closest(".attachment-lightbox-dialog") && !target.closest("#attachmentLightboxClose")) {
    return;
  }
  closeAttachmentPreview();
});

elements.attachmentLightboxClose?.addEventListener("click", () => {
  closeAttachmentPreview();
});

elements.workbenchTabs?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const tab = target?.closest("[data-view-switch]") as HTMLElement | null;
  const nextView = tab?.dataset.viewSwitch;
  if (!isWorkspaceView(nextView) || !state.projectId) {
    return;
  }

  setActiveView(nextView);
  render();
});

elements.modelBadge?.addEventListener("click", () => {
  void promptForModel();
});

api.onProjectId((projectId) => {
  void selectProject(projectId);
});

api.onProjectSessionSnapshot((snapshot) => {
  state.sessionsByProjectId.set(snapshot.projectId, snapshot);
  if (snapshot.projectId === state.projectId) {
    syncActiveViewForCurrentProject();
  }
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.attachmentPreview) {
    closeAttachmentPreview();
  }
});

void loadI18n();
void syncProjects();
render();
