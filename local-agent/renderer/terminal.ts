type Lang = "en" | "zh";
type WorkspaceView = "messages" | "activity" | "cli" | "queue";
type SidebarListMode = "messages" | "contacts";
type AttachmentKind = "image" | "file";
type VoiceInputMode = "transcribe" | "send";
const MAX_ACTIVITY_PANEL_ITEMS = 30;
type ProviderUiApi = {
  getProviderLabel?: (provider: string) => string;
  listModelProviderPresets?: () => Array<{
    id: string;
    name: string;
    protocol: "openai" | "anthropic";
    defaultModel: string;
  }>;
};
type ClientCapabilitiesApi = {
  supportsDesktopCapability?: (key: string) => boolean;
};

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
  getProjects: (options?: { refreshRemote?: boolean }) => Promise<ProjectState[]>;
  onProjectsChanged?: (callback: (projects: ProjectState[]) => void) => void;
  onProjectSessionSnapshot: (callback: (snapshot: SessionSnapshot) => void) => void;
  listWorkgroupCollaborations?: () => Promise<{ success: boolean; workgroups?: WorkgroupSummary[]; error?: string }>;
  onWorkgroupCollaborationSummaries?: (callback: (workgroups: WorkgroupSummary[]) => void) => void;
  onWorkgroupCollaborationSnapshot?: (callback: (snapshot: WorkgroupSessionSnapshot) => void) => void;
  onWorkgroupCollaborationId?: (callback: (workgroupId: string | null) => void) => void;
  getProjectSession: (data: { projectId: string; forceRemoteSync?: boolean }) => Promise<ProjectSessionResponse>;
  getProjectHistoryPage?: (data: {
    projectId: string;
    kind: "messages" | "activities" | "cli";
    conversationId?: string | null;
    beforeId?: string | null;
    limit?: number;
  }) => Promise<ProjectHistoryPageResponse>;
  searchProjectMessages?: (data: {
    projectId: string;
    query: string;
    conversationId?: string | null;
    limit?: number;
  }) => Promise<{ success: boolean; error?: string; items?: SessionMessage[] }>;
  getWorkgroupCollaborationSession?: (workgroupId: string) => Promise<{ success: boolean; session?: WorkgroupSessionSnapshot; error?: string }>;
  getWorkgroupCollaborationHistoryPage?: (data: {
    workgroupId: string;
    beforeId?: string | null;
    limit?: number;
  }) => Promise<WorkgroupHistoryPageResponse>;
  searchWorkgroupCollaborationMessages?: (data: {
    workgroupId: string;
    query: string;
    limit?: number;
  }) => Promise<{ success: boolean; error?: string; items?: WorkgroupMessage[] }>;
  createProjectConversation?: (projectId: string) => Promise<{ success: boolean; error?: string; conversationId?: string }>;
  activateProjectConversation?: (data: { projectId: string; conversationId: string }) => Promise<{ success: boolean; error?: string }>;
  sendProjectPrompt: (data: {
    projectId: string;
    prompt: string;
    attachments?: AttachmentRef[];
    reasoningEffort?: ComposerReasoningEffort | null;
  }) => Promise<{ success: boolean; error?: string }>;
  updateProject?: (data: {
    projectId: string;
    updates: Record<string, string | boolean | null>;
  }) => Promise<{ success: boolean; error?: string }>;
  listModelOptions?: (options?: { force?: boolean; projectId?: string | null }) => Promise<{
    success: boolean;
    error?: string;
    providers?: ModelProviderOption[];
  }>;
  sendWorkgroupCollaborationMessage?: (data: { workgroupId: string; content: string }) => Promise<{ success: boolean; error?: string }>;
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
  steerQueuedProjectPrompt: (data: { projectId: string; runId: string }) => Promise<{ success: boolean; error?: string }>;
  onProjectId: (callback: (projectId: string | null) => void) => void;
  getLang?: () => Promise<Lang>;
  getI18nMessages?: () => Promise<Record<string, string>>;
  onLangChanged?: (callback: (payload: LangPayload) => void) => void;
  openSettingsWindow?: (pane?: "connection" | "project" | "system") => void;
  setActiveProject?: (projectId: string | null) => void;
  setActiveWorkgroupCollaboration?: (workgroupId: string | null) => void;
  pickLocalDataRoot?: (currentPath?: string | null) => Promise<{ success: boolean; path?: string | null; error?: string }>;
  openLocalDataRoot?: (currentPath?: string | null) => Promise<{ success: boolean; error?: string }>;
  changeLocalDataRoot?: (nextPath?: string | null) => Promise<{ success: boolean; changed?: boolean; restartRequired?: boolean; localDataRoot?: string; error?: string }>;
  minimizeWindow?: () => void;
  maximizeWindow?: () => void;
  closeWindow?: () => void;
  createTemporaryAccessLink?: (data: {
    targetAgentId?: string | null;
    projectIds?: string[] | null;
    scopeType?: string | null;
    capabilityBundle?: string | null;
    allowFileDownload?: boolean;
    allowDiagnostics?: boolean;
    expiresAt?: string | null;
    maxUses?: number | null;
    note?: string | null;
  }) => Promise<{ success: boolean; error?: string; url?: string; apiUrl?: string; token?: string; remainingUses?: number }>;
  getConfig?: () => Promise<{
    openaiDefaultModel?: string | null;
    anthropicDefaultModel?: string | null;
    modelProviderProfiles?: Array<{
      id?: string | null;
      name?: string | null;
      protocol?: "openai" | "anthropic" | string | null;
      defaultModel?: string | null;
      enabled?: boolean | null;
    }> | null;
    activeModelProviderProfileByProtocol?: Partial<Record<"openai" | "anthropic", string>> | null;
  }>;
}

interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  attachments?: AttachmentRef[];
  provider?: "claude" | "codex" | null;
  source: "remote" | "desktop" | "workgroup";
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
  meta?: Record<string, string | number | boolean>;
}

interface QueuedRunItem {
  runId: string;
  prompt: string;
  source: "remote" | "desktop" | "workgroup";
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
  currentSource: "remote" | "desktop" | "workgroup" | null;
  currentPrompt?: string | null;
  currentStartedAt?: number | null;
  activeConversationId: string | null;
  conversations: ConversationSummary[];
  messageTotal: number;
  activityTotal: number;
  cliTraceTotal: number;
  queue: QueuedRunItem[];
  cliTrace: CliTraceEntry[];
  messages: SessionMessage[];
  activities: SessionActivity[];
}

interface ProjectState {
  id: string;
  agentId?: string;
  name: string;
  path: string;
  groupName?: string | null;
  cliProvider: "claude" | "codex";
  cliModel?: string | null;
  codexWebSearchEnabled?: boolean;
  online?: boolean;
  isRemote?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  messageCount: number;
  activityCount: number;
  cliCount: number;
}

interface ProjectSessionResponse {
  success: boolean;
  error?: string;
  project?: ProjectState;
  session?: SessionSnapshot;
}

interface HistoryPage<T> {
  conversationId: string | null;
  items: T[];
  hasMore: boolean;
  total: number;
}

interface ProjectHistoryPageResponse {
  success: boolean;
  error?: string;
  page?: HistoryPage<SessionMessage | SessionActivity | CliTraceEntry>;
}

interface ProjectHistoryState {
  conversationId: string | null;
  messages: SessionMessage[];
  activities: SessionActivity[];
  cliTrace: CliTraceEntry[];
  hasMoreMessages: boolean;
  hasMoreActivities: boolean;
  hasMoreCli: boolean;
  loadingMessages: boolean;
  loadingActivities: boolean;
  loadingCli: boolean;
}

interface WorkgroupSummary {
  id: string;
  name: string;
  description?: string | null;
  updatedAt: number;
  isRunning: boolean;
  lastMessagePreview?: string | null;
  messageCount: number;
  memberCount: number;
}

interface WorkgroupMessage {
  id: string;
  workgroupId: string;
  senderType: "user" | "member" | "system" | "error";
  senderName: string;
  memberId?: string | null;
  memberRole?: "member" | "project_manager" | null;
  projectId?: string | null;
  projectKind?: "local" | "remote" | null;
  dispatchRunId?: string | null;
  triggerMessageId?: string | null;
  content: string;
  status: "streaming" | "done";
  createdAt: number;
  updatedAt: number;
}

interface WorkgroupMemberState {
  id: string;
  name: string;
  role: "member" | "project_manager";
  projectId?: string | null;
  projectName?: string | null;
  projectKind?: "local" | "remote" | null;
  projectOnline: boolean;
  hasBinding: boolean;
  isRunning: boolean;
}

interface WorkgroupSessionSnapshot {
  workgroupId: string;
  workgroupName: string;
  description?: string | null;
  allowDirectMemberMessages: boolean;
  updatedAt: number;
  isRunning: boolean;
  messageTotal: number;
  members: WorkgroupMemberState[];
  messages: WorkgroupMessage[];
}

interface MentionSuggestionItem {
  key: string;
  token: string;
  label: string;
  role: WorkgroupMemberState["role"] | null;
  kind: "special" | "member";
  searchText: string;
}

interface WorkgroupHistoryPageResponse {
  success: boolean;
  error?: string;
  page?: {
    items: WorkgroupMessage[];
    hasMore: boolean;
    total: number;
  };
}

interface WorkgroupHistoryState {
  messages: WorkgroupMessage[];
  hasMoreMessages: boolean;
  loadingMessages: boolean;
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

interface WorkspaceDraftState {
  text: string;
  attachments: AttachmentRef[];
}

type ComposerRunMode = "normal" | "plan" | "goal";
type ComposerReasoningEffort = "auto" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface RenderOptions {
  staticI18n?: boolean;
  projectList?: boolean;
  header?: boolean;
  workbench?: boolean;
  panel?: boolean;
  attachments?: boolean;
  lightbox?: boolean;
  hint?: boolean;
}

interface Window {
  claudeAgent: ClaudeAgentApi;
}

const api = window.claudeAgent;
const WORKSPACE_RENDER_DEBOUNCE_MS = 90;

const elements = {
  projectTitle: document.getElementById("projectTitle"),
  projectMeta: document.getElementById("projectMeta"),
  providerBadge: document.getElementById("providerBadge"),
  modelBadge: document.getElementById("modelBadge") as HTMLButtonElement | null,
  modeBadge: document.getElementById("modeBadge"),
  runState: document.getElementById("runState"),
  headerSummary: document.getElementById("headerSummary"),
  conversationSelect: document.getElementById("conversationSelect") as HTMLSelectElement | null,
  newConversationBtn: document.getElementById("newConversationBtn") as HTMLButtonElement | null,
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
  sidebarProjectsTab: document.getElementById("sidebarProjectsTab") as HTMLButtonElement | null,
  sidebarProjectsTabLabel: document.getElementById("sidebarProjectsTabLabel"),
  sidebarWorkgroupsTab: document.getElementById("sidebarWorkgroupsTab") as HTMLButtonElement | null,
  sidebarWorkgroupsTabLabel: document.getElementById("sidebarWorkgroupsTabLabel"),
  projectSearchInput: document.getElementById("projectSearchInput") as HTMLInputElement | null,
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
  messagesJumpButton: document.getElementById("messagesJumpButton") as HTMLButtonElement | null,
  activityJumpButton: document.getElementById("activityJumpButton") as HTMLButtonElement | null,
  messageSearchInput: document.getElementById("messageSearchInput") as HTMLInputElement | null,
  activityList: document.getElementById("activityList"),
  composerForm: document.getElementById("composerForm") as HTMLFormElement | null,
  composerInput: document.getElementById("composerInput") as HTMLTextAreaElement | null,
  composerModelBtn: document.getElementById("composerModelBtn") as HTMLButtonElement | null,
  composerRunModeSelect: document.getElementById("composerRunModeSelect") as HTMLSelectElement | null,
  composerReasoningSelect: document.getElementById("composerReasoningSelect") as HTMLSelectElement | null,
  mentionSuggestions: document.getElementById("mentionSuggestions"),
  composerHint: document.getElementById("composerHint"),
  attachImageBtn: document.getElementById("attachImageBtn") as HTMLButtonElement | null,
  attachFileBtn: document.getElementById("attachFileBtn") as HTMLButtonElement | null,
  voiceInputBtn: document.getElementById("voiceInputBtn") as HTMLButtonElement | null,
  voiceInputModeSelect: document.getElementById("voiceInputModeSelect") as HTMLSelectElement | null,
  attachmentTray: document.getElementById("attachmentTray"),
  stopBtn: document.getElementById("stopBtn") as HTMLButtonElement | null,
  sendBtn: document.getElementById("sendBtn") as HTMLButtonElement | null,
  projectsTitle: document.getElementById("projectsTitle"),
  sessionViewTitle: document.getElementById("sessionViewTitle"),
  composerLabel: document.getElementById("composerLabel"),
  serverSettingsBtn: document.getElementById("serverSettingsBtn") as HTMLButtonElement | null,
  projectSettingsBtn: document.getElementById("projectSettingsBtn") as HTMLButtonElement | null,
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
  workgroupId: string | null;
  projects: ProjectState[];
  workgroups: WorkgroupSummary[];
  sessionsByProjectId: Map<string, SessionSnapshot>;
  historyByProjectId: Map<string, ProjectHistoryState>;
  sessionsByWorkgroupId: Map<string, WorkgroupSessionSnapshot>;
  historyByWorkgroupId: Map<string, WorkgroupHistoryState>;
  lang: Lang;
  messages: Record<string, string>;
  activeView: WorkspaceView;
  sidebarMode: SidebarListMode;
  projectSearchQuery: string;
  messageSearchQuery: string;
  messageSearchWorkspaceKey: string | null;
  messageSearchProjectResults: SessionMessage[] | null;
  messageSearchWorkgroupResults: WorkgroupMessage[] | null;
  messageSearchLoading: boolean;
  pendingAttachments: AttachmentRef[];
  composerRunMode: ComposerRunMode;
  composerReasoningEffort: ComposerReasoningEffort;
  draftsByWorkspaceKey: Map<string, WorkspaceDraftState>;
  preferredViews: Record<"claude" | "codex", WorkspaceView>;
  groupOrder: string[];
  collapsedGroups: Set<string>;
  forceDockScroll: WorkspaceView | null;
  lastRenderedMessagesViewportKey: string | null;
  lastRenderedActivityViewportKey: string | null;
  hint: HintState;
  attachmentPreview: AttachmentPreviewState | null;
} = {
  projectId: null,
  workgroupId: null,
  projects: [],
  workgroups: [],
  sessionsByProjectId: new Map<string, SessionSnapshot>(),
  historyByProjectId: new Map<string, ProjectHistoryState>(),
  sessionsByWorkgroupId: new Map<string, WorkgroupSessionSnapshot>(),
  historyByWorkgroupId: new Map<string, WorkgroupHistoryState>(),
  lang: "en",
  messages: {},
  activeView: "messages",
  sidebarMode: "messages",
  projectSearchQuery: "",
  messageSearchQuery: "",
  messageSearchWorkspaceKey: null,
  messageSearchProjectResults: null,
  messageSearchWorkgroupResults: null,
  messageSearchLoading: false,
  pendingAttachments: [],
  composerRunMode: "normal",
  composerReasoningEffort: "auto",
  draftsByWorkspaceKey: new Map<string, WorkspaceDraftState>(),
  preferredViews: {
    claude: "messages",
    codex: "messages",
  },
  groupOrder: [],
  collapsedGroups: new Set<string>(),
  forceDockScroll: null,
  lastRenderedMessagesViewportKey: null,
  lastRenderedActivityViewportKey: null,
  hint: {
    key: "terminal.hint.default",
    fallback: "Press Enter to send, Shift+Enter for a new line. Conversation stays in front, with Activity, CLI, and Queue one tab away.",
    isError: false,
  },
  attachmentPreview: null,
};

let draggingGroupKey: string | null = null;
let dragOverGroupKey: string | null = null;
let messageSearchTimer: number | null = null;
let projectListRenderTimer: number | null = null;
let workspaceRenderTimer: number | null = null;
let projectSearchTimer: number | null = null;
let pendingMessagesScrollFrame: number | null = null;
let pendingMessagesScrollTimeout: number | null = null;
let pendingActivityScrollFrame: number | null = null;
let pendingActivityScrollTimeout: number | null = null;
const historyAutoloadTimers: Partial<Record<"messages" | "activities" | "cli", number>> = {};
let lastConversationSelectSignature = "";
let lastProjectCatalogSignature = "";
let lastWorkgroupSummarySignature = "";
const lastProjectSnapshotSignatureByProjectId = new Map<string, string>();
const lastWorkgroupSnapshotSignatureById = new Map<string, string>();
const projectSessionLoads = new Map<string, Promise<void>>();
const workgroupSessionLoads = new Map<string, Promise<void>>();
const renderSignatures: Record<"projectList" | "workbench" | "queue" | "cli" | "messages" | "activities" | "attachments" | "mentions" | "header", string> = {
  projectList: "",
  workbench: "",
  queue: "",
  cli: "",
  messages: "",
  activities: "",
  attachments: "",
  mentions: "",
  header: "",
};
let lastDocumentTitle = "";
let activeSpeechRecognition: any = null;
let isVoiceListening = false;
let voiceInputMode: VoiceInputMode = "transcribe";
const mentionState: {
  query: string;
  rangeStart: number;
  rangeEnd: number;
  activeIndex: number;
  items: MentionSuggestionItem[];
} = {
  query: "",
  rangeStart: -1,
  rangeEnd: -1,
  activeIndex: 0,
  items: [],
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(value: string, query: string): string {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return escapeHtml(value);
  }

  const pattern = new RegExp(`(${escapeRegExp(normalizedQuery)})`, "ig");
  return value
    .split(pattern)
    .map((segment, index) => {
      if (index % 2 === 1) {
        return `<mark class="search-mark">${escapeHtml(segment)}</mark>`;
      }
      return escapeHtml(segment);
    })
    .join("");
}

function sanitizeMarkdownUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed, window.location.href);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

function renderMarkdownInline(value: string, query: string): string {
  const tick = String.fromCharCode(96);
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const nextCode = value.indexOf(tick, cursor);
    const nextLink = value.indexOf("[", cursor);
    const candidates = [nextCode, nextLink].filter((index) => index >= 0);
    const next = candidates.length > 0 ? Math.min(...candidates) : -1;
    if (next < 0) {
      output += renderMarkdownEmphasis(value.slice(cursor), query);
      break;
    }

    output += renderMarkdownEmphasis(value.slice(cursor, next), query);
    if (next === nextCode) {
      const closing = value.indexOf(tick, next + 1);
      if (closing < 0) {
        output += renderMarkdownEmphasis(value.slice(next), query);
        break;
      }
      output += "<code>" + highlightText(value.slice(next + 1, closing), query) + "</code>";
      cursor = closing + 1;
      continue;
    }

    const labelEnd = value.indexOf("]", next + 1);
    const hrefStart = labelEnd >= 0 && value[labelEnd + 1] === "(" ? labelEnd + 2 : -1;
    const hrefEnd = hrefStart >= 0 ? value.indexOf(")", hrefStart) : -1;
    if (labelEnd < 0 || hrefStart < 0 || hrefEnd < 0) {
      output += renderMarkdownEmphasis(value.slice(next, next + 1), query);
      cursor = next + 1;
      continue;
    }

    const href = sanitizeMarkdownUrl(value.slice(hrefStart, hrefEnd));
    const label = value.slice(next + 1, labelEnd);
    if (!href) {
      output += renderMarkdownEmphasis(value.slice(next, hrefEnd + 1), query);
      cursor = hrefEnd + 1;
      continue;
    }
    output += "<a href=\"" + escapeHtml(href) + "\" target=\"_blank\" rel=\"noreferrer noopener\">"
      + renderMarkdownEmphasis(label, query)
      + "</a>";
    cursor = hrefEnd + 1;
  }
  return output;
}

function renderMarkdownEmphasis(value: string, query: string): string {
  const tokenPattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  return value
    .split(tokenPattern)
    .map((segment) => {
      if ((segment.startsWith("**") && segment.endsWith("**")) || (segment.startsWith("__") && segment.endsWith("__"))) {
        return "<strong>" + highlightText(segment.slice(2, -2), query) + "</strong>";
      }
      if ((segment.startsWith("*") && segment.endsWith("*")) || (segment.startsWith("_") && segment.endsWith("_"))) {
        return "<em>" + highlightText(segment.slice(1, -1), query) + "</em>";
      }
      return highlightText(segment, query);
    })
    .join("");
}

function renderMarkdownParagraph(lines: string[], query: string): string {
  return "<p>" + lines.map((line) => renderMarkdownInline(line, query)).join("<br>") + "</p>";
}

function renderMarkdownTextBlocks(value: string, query: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    blocks.push(renderMarkdownParagraph(paragraph, query));
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = Math.min(heading[1].length, 4);
      blocks.push("<h" + level + ">" + renderMarkdownInline(heading[2], query) + "</h" + level + ">");
      continue;
    }

    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      flushParagraph();
      blocks.push("<hr>");
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push("<blockquote>" + renderMarkdownParagraph(quoteLines, query) + "</blockquote>");
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = orderedList ? /^\d+[.)]\s+(.+)$/.exec(current) : /^[-*+]\s+(.+)$/.exec(current);
        if (!match) {
          break;
        }
        items.push("<li>" + renderMarkdownInline(match[1], query) + "</li>");
        index += 1;
      }
      index -= 1;
      const tag = orderedList ? "ol" : "ul";
      blocks.push("<" + tag + ">" + items.join("") + "</" + tag + ">");
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks.join("");
}

function renderMarkdownContent(value: string, query: string): string {
  const fenceText = String.fromCharCode(96, 96, 96);
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let textLines: string[] = [];
  const flushText = () => {
    if (textLines.length === 0) {
      return;
    }
    blocks.push(renderMarkdownTextBlocks(textLines.join("\n"), query));
    textLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed.startsWith(fenceText)) {
      textLines.push(lines[index]);
      continue;
    }

    flushText();
    const languageName = trimmed.slice(fenceText.length).trim().split(/\s+/)[0] ?? "";
    const language = languageName ? "<span class=\"markdown-code-language\">" + escapeHtml(languageName) + "</span>" : "";
    const codeLines: string[] = [];
    index += 1;
    while (index < lines.length && lines[index].trim() !== fenceText) {
      codeLines.push(lines[index]);
      index += 1;
    }
    blocks.push("<pre>" + language + "<code>" + highlightText(codeLines.join("\n"), query) + "</code></pre>");
  }

  flushText();
  return blocks.join("") || "&nbsp;";
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

const storageKeys = {
  groupOrder: "claude.projectGroupOrder.v1",
  groupCollapsed: "claude.projectGroupCollapsed.v1",
  voiceInputMode: "agentflow.voiceInputMode.v1",
};

function readStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorageJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures (private mode, quota exceeded).
  }
}

function hydrateProjectGroupState(): void {
  const storedOrder = readStorageJson<string[]>(storageKeys.groupOrder, []);
  const storedCollapsed = readStorageJson<string[]>(storageKeys.groupCollapsed, []);
  state.groupOrder = Array.isArray(storedOrder) ? storedOrder : [];
  state.collapsedGroups = new Set(Array.isArray(storedCollapsed) ? storedCollapsed : []);
}

function persistGroupOrder(): void {
  writeStorageJson(storageKeys.groupOrder, state.groupOrder);
}

function persistCollapsedGroups(): void {
  writeStorageJson(storageKeys.groupCollapsed, Array.from(state.collapsedGroups));
}

function getLocale(): string {
  return state.lang === "zh" ? "zh-CN" : "en-US";
}

function getProviderUiApi(): ProviderUiApi | null {
  const root = globalThis as unknown as { ProviderUi?: ProviderUiApi };
  return root.ProviderUi ?? null;
}

function getClientCapabilitiesApi(): ClientCapabilitiesApi | null {
  const root = globalThis as unknown as { ClientCapabilities?: ClientCapabilitiesApi };
  return root.ClientCapabilities ?? null;
}

function providerLabel(provider: "claude" | "codex"): string {
  return getProviderUiApi()?.getProviderLabel?.(provider) || (provider === "codex" ? "OpenAI Codex" : "Claude Code");
}

function supportsDesktopCapability(key: string): boolean {
  return getClientCapabilitiesApi()?.supportsDesktopCapability?.(key) !== false;
}

function syncAttachmentButtons(): void {
  const imageSupported = supportsDesktopCapability("messageAttachmentImages");
  const fileSupported = supportsDesktopCapability("messageAttachmentFiles");

  if (elements.attachImageBtn) {
    elements.attachImageBtn.hidden = !imageSupported;
    elements.attachImageBtn.disabled = !state.projectId || !imageSupported;
  }
  if (elements.attachFileBtn) {
    elements.attachFileBtn.hidden = !fileSupported;
    elements.attachFileBtn.disabled = !state.projectId || !fileSupported;
  }
  updateVoiceInputButton();
}

function modelLabel(model: string | null | undefined): string {
  const value = model?.trim() ?? "";
  return value || inlineText("Auto", "自动");
}

type ModelProviderProtocol = "openai" | "anthropic";

interface ModelChoice {
  model: string | null;
  label: string;
  detail: string;
}

interface ModelProviderOption {
  id: string;
  name: string;
  protocol: ModelProviderProtocol;
  defaultModel: string | null;
  models: string[];
  configured: boolean;
  credentialSource?: "config" | "env" | "none";
  error?: string;
  source?: "local" | "remote";
}

function providerProtocol(provider: "claude" | "codex"): ModelProviderProtocol {
  return provider === "claude" ? "anthropic" : "openai";
}

function addModelChoice(choices: ModelChoice[], seen: Set<string>, model: string | null, detail: string): void {
  const normalized = model?.trim() ?? "";
  const key = normalized.toLowerCase() || "auto";
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  choices.push({
    model: normalized || null,
    label: modelLabel(normalized),
    detail,
  });
}

function getPresetModelChoices(provider: "claude" | "codex"): ModelChoice[] {
  const protocol = providerProtocol(provider);
  const presets = getProviderUiApi()?.listModelProviderPresets?.() ?? [];
  const choices: ModelChoice[] = [];
  const seen = new Set<string>();
  for (const preset of presets) {
    if (preset.protocol !== protocol || !preset.defaultModel?.trim()) {
      continue;
    }
    addModelChoice(
      choices,
      seen,
      preset.defaultModel,
      inlineText(`Upstream preset: ${preset.name}`, `上游预设：${preset.name}`),
    );
  }
  return choices;
}

async function buildModelChoices(project: ProjectState, session: SessionSnapshot | null): Promise<ModelChoice[]> {
  const provider = getConfiguredProvider(project, session);
  const protocol = providerProtocol(provider);
  const choices: ModelChoice[] = [];
  const seen = new Set<string>();

  addModelChoice(choices, seen, null, inlineText("Use the active provider default", "使用当前服务商默认模型"));
  addModelChoice(choices, seen, session?.model ?? null, inlineText("Synced from current session", "从当前会话同步"));
  addModelChoice(choices, seen, project.cliModel ?? null, inlineText("Synced from project settings", "从项目配置同步"));

  try {
    const config = await api.getConfig?.();
    const profiles = Array.isArray(config?.modelProviderProfiles) ? config.modelProviderProfiles : [];
    const activeId = config?.activeModelProviderProfileByProtocol?.[protocol];
    const matchingProfiles = profiles.filter((profile) => (
      profile
      && profile.enabled !== false
      && profile.protocol === protocol
      && typeof profile.defaultModel === "string"
      && profile.defaultModel.trim()
    ));
    const activeProfile = matchingProfiles.find((profile) => profile.id === activeId);
    if (activeProfile) {
      addModelChoice(
        choices,
        seen,
        activeProfile.defaultModel ?? null,
        inlineText(`Active provider: ${activeProfile.name || activeProfile.id || providerLabel(provider)}`, `当前服务商：${activeProfile.name || activeProfile.id || providerLabel(provider)}`),
      );
    }
    for (const profile of matchingProfiles) {
      addModelChoice(
        choices,
        seen,
        profile.defaultModel ?? null,
        inlineText(`Configured provider: ${profile.name || profile.id || providerLabel(provider)}`, `已配置服务商：${profile.name || profile.id || providerLabel(provider)}`),
      );
    }
    const legacyDefault = protocol === "openai" ? config?.openaiDefaultModel : config?.anthropicDefaultModel;
    addModelChoice(choices, seen, legacyDefault ?? null, inlineText("Configured default model", "已配置默认模型"));
  } catch (error) {
    console.warn("Failed to load configured model choices", error);
  }

  for (const choice of getPresetModelChoices(provider)) {
    addModelChoice(choices, seen, choice.model, choice.detail);
  }

  return choices;
}

function providerForProtocol(protocol: ModelProviderProtocol): "claude" | "codex" {
  return protocol === "anthropic" ? "claude" : "codex";
}

function providerOptionDetail(option: ModelProviderOption): string {
  if (option.source === "remote" && option.error) {
    return option.error;
  }
  if (option.error) {
    return inlineText(
      `Model API unavailable: ${option.error}. Showing configured defaults.`,
      `模型 API 不可用：${option.error}。当前显示已配置默认模型。`,
    );
  }
  if (option.source === "remote") {
    return inlineText("Models loaded from the remote desktop environment.", "模型列表来自远端桌面环境。");
  }
  if (option.credentialSource === "env") {
    return inlineText("Models loaded from this desktop's environment variables.", "模型列表来自本机环境变量。");
  }
  if (option.credentialSource === "config") {
    return inlineText("Models loaded from the local provider configuration.", "模型列表来自本地模型配置。");
  }
  if (option.configured) {
    return inlineText("Models loaded from configured API or environment.", "模型列表来自已配置 API 或环境变量。");
  }
  return inlineText("No API key found; showing configured defaults.", "未找到 API Key，显示已配置默认模型。");
}

function providerOptionSourceLabel(option: ModelProviderOption): string {
  if (option.source === "remote") {
    return inlineText("Remote env", "远端环境");
  }
  if (option.credentialSource === "env") {
    return inlineText("Local env", "本机环境");
  }
  if (option.credentialSource === "config") {
    return inlineText("Local config", "本地配置");
  }
  return inlineText("Default", "默认");
}

async function buildModelProviderOptions(
  project: ProjectState,
  session: SessionSnapshot | null,
  options: { force?: boolean } = {},
): Promise<ModelProviderOption[]> {
  const currentProvider = getConfiguredProvider(project, session);
  const currentProtocol = providerProtocol(currentProvider);
  const currentModel = getConfiguredModel(project, session)?.trim() ?? "";
  try {
    const response = await api.listModelOptions?.({
      force: options.force === true,
      projectId: project.isRemote ? project.id : null,
    });
    if (response?.success && Array.isArray(response.providers) && response.providers.length > 0) {
      return response.providers.map((providerOption) => ({
        ...providerOption,
        source: project.isRemote ? "remote" : "local",
        models: mergeModelValues([
          providerOption.defaultModel,
          ...providerOption.models,
          providerOption.protocol === currentProtocol ? currentModel : null,
        ]),
      }));
    }
    if (project.isRemote) {
      return [buildRemoteModelOptionsFallback(project, session, response?.error)];
    }
  } catch (error) {
    console.warn("Failed to load upstream model options", error);
    if (project.isRemote) {
      return [buildRemoteModelOptionsFallback(project, session, error instanceof Error ? error.message : String(error))];
    }
  }

  const fallbackChoices = await buildModelChoices(project, session);
  return [{
    id: currentProvider,
    name: providerLabel(currentProvider),
    protocol: currentProtocol,
    defaultModel: project.cliModel ?? session?.model ?? null,
    models: mergeModelValues(fallbackChoices.map((choice) => choice.model)),
    configured: false,
    error: inlineText("Using local fallback model list", "正在使用本地兜底模型列表"),
  }];
}

function buildRemoteModelOptionsFallback(
  project: ProjectState,
  session: SessionSnapshot | null,
  error?: string,
): ModelProviderOption {
  const currentProvider = getConfiguredProvider(project, session);
  const currentProtocol = providerProtocol(currentProvider);
  const currentModel = getConfiguredModel(project, session)?.trim() ?? "";
  return {
    id: currentProvider,
    name: providerLabel(currentProvider),
    protocol: currentProtocol,
    defaultModel: project.cliModel ?? session?.model ?? null,
    models: mergeModelValues([
      currentModel,
      project.cliModel ?? null,
      session?.model ?? null,
    ]),
    configured: false,
    error: error
      ? inlineText("Remote model list unavailable: " + error, "远端模型列表不可用：" + error)
      : inlineText("Remote model list unavailable. Showing only the current remote model.", "远端模型列表不可用，仅显示当前远端模型。"),
    source: "remote",
  };
}

function mergeModelValues(models: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const model of models) {
    const normalized = model?.trim() ?? "";
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isComposerRunMode(value: string | null | undefined): value is ComposerRunMode {
  return value === "normal" || value === "plan" || value === "goal";
}

function isComposerReasoningEffort(value: string | null | undefined): value is ComposerReasoningEffort {
  return value === "auto"
    || value === "minimal"
    || value === "low"
    || value === "medium"
    || value === "high"
    || value === "xhigh";
}

function composerRunModeLabel(mode: ComposerRunMode): string {
  if (mode === "plan") {
    return inlineText("Plan", "计划");
  }
  if (mode === "goal") {
    return inlineText("Goal", "目标");
  }
  return inlineText("Normal", "普通");
}

function composerReasoningLabel(effort: ComposerReasoningEffort): string {
  if (effort === "minimal") {
    return inlineText("Minimal", "极低");
  }
  if (effort === "low") {
    return inlineText("Low", "低");
  }
  if (effort === "medium") {
    return inlineText("Medium", "中");
  }
  if (effort === "high") {
    return inlineText("High", "高");
  }
  if (effort === "xhigh") {
    return inlineText("XHigh", "极高");
  }
  return inlineText("Auto", "自动");
}

function syncComposerRunModeSelect(enabled: boolean, disabledTitle?: string): void {
  const select = elements.composerRunModeSelect;
  if (!select) {
    return;
  }
  const labels: Record<ComposerRunMode, string> = {
    normal: composerRunModeLabel("normal"),
    plan: composerRunModeLabel("plan"),
    goal: composerRunModeLabel("goal"),
  };
  for (const option of Array.from(select.options)) {
    if (isComposerRunMode(option.value)) {
      option.textContent = labels[option.value];
    }
  }
  if (!enabled) {
    state.composerRunMode = "normal";
  }
  select.value = state.composerRunMode;
  select.disabled = !enabled;
  select.hidden = false;
  select.title = enabled
    ? inlineText("Choose how the next prompt runs", "选择下一条提示词的运行模式")
    : (disabledTitle ?? inlineText("Run modes are available for Codex projects", "运行模式仅在 Codex 项目中可用"));
}

function syncComposerReasoningSelect(enabled: boolean, disabledTitle?: string): void {
  const select = elements.composerReasoningSelect;
  if (!select) {
    return;
  }
  for (const option of Array.from(select.options)) {
    if (isComposerReasoningEffort(option.value)) {
      option.textContent = `${inlineText("Reasoning", "推理")}: ${composerReasoningLabel(option.value)}`;
    }
  }
  if (!enabled) {
    state.composerReasoningEffort = "auto";
  }
  select.value = state.composerReasoningEffort;
  select.disabled = !enabled;
  select.hidden = false;
  select.title = enabled
    ? inlineText("Choose Codex reasoning effort for the next prompt", "选择下一条 Codex 提示词的推理强度")
    : (disabledTitle ?? inlineText("Reasoning effort is available for Codex projects", "推理强度仅在 Codex 项目中可用"));
}

function getComposerReasoningEffortForSend(): ComposerReasoningEffort | null {
  const project = getCurrentProject();
  const session = getCurrentSession();
  const provider = getConfiguredProvider(project, session);
  if (!project || provider !== "codex" || state.workgroupId || state.composerReasoningEffort === "auto") {
    return null;
  }
  return state.composerReasoningEffort;
}

function translateSource(source: "remote" | "desktop" | "workgroup"): string {
  if (source === "remote") {
    return msg("terminal.source.remote", "remote");
  }
  if (source === "workgroup") {
    return inlineText("workgroup", "协作组");
  }
  return msg("terminal.source.desktop", "desktop");
}

function isPrivateProjectMessage(message: SessionMessage | null | undefined): boolean {
  return Boolean(message) && message?.source !== "workgroup";
}

function getVisibleSessionMessages(session: SessionSnapshot | null): SessionMessage[] {
  if (!session) {
    return [];
  }
  return session.messages.filter((message) => isPrivateProjectMessage(message));
}

function isPrivateProjectActivity(activity: SessionActivity | null | undefined): boolean {
  return Boolean(activity) && activity?.meta?.source !== "workgroup";
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

function getProjectGroupKey(project: ProjectState): string {
  if (project.isRemote) {
    return "__remote__";
  }
  const name = project.groupName?.trim();
  return name && name.length > 0 ? name : "__default__";
}

function getProjectGroupLabel(project: ProjectState): string {
  if (project.isRemote) {
    return inlineText("Remote", "远程");
  }
  const name = project.groupName?.trim();
  return name && name.length > 0 ? name : inlineText("Default", "默认分组");
}

function getOrderedGroupKeys(groupKeys: string[]): string[] {
  const normalized = Array.from(new Set(groupKeys));
  const fixedKeys = ["__remote__", "__default__"].filter((name) => normalized.includes(name));
  const ordered = state.groupOrder.filter((name) => normalized.includes(name) && !fixedKeys.includes(name));
  const remaining = normalized.filter((name) => !ordered.includes(name) && !fixedKeys.includes(name));
  return [...fixedKeys, ...ordered, ...remaining];
}

function reorderGroupKeys(order: string[], source: string, target: string): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) {
    return order;
  }
  const next = order.filter((name) => name !== source);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex, 0, source);
  return next;
}

function getCurrentGroupKeys(): string[] {
  return Array.from(new Set(state.projects.map((project) => getProjectGroupKey(project))));
}

function toggleGroupCollapsed(groupKey: string): void {
  if (!groupKey) {
    return;
  }
  if (state.collapsedGroups.has(groupKey)) {
    state.collapsedGroups.delete(groupKey);
  } else {
    state.collapsedGroups.add(groupKey);
  }
  persistCollapsedGroups();
  renderProjectList();
}

function applyGroupOrderFromDrag(source: string, target: string): void {
  if (!source || !target || source === target) {
    return;
  }
  const ordered = getOrderedGroupKeys(getCurrentGroupKeys());
  const next = reorderGroupKeys(ordered, source, target);
  if (next.join("|") === ordered.join("|")) {
    return;
  }
  state.groupOrder = next;
  persistGroupOrder();
  renderProjectList();
}

function getProjectLastActivityAt(projectId: string): number {
  const session = state.sessionsByProjectId.get(projectId) ?? null;
  if (!session) {
    return 0;
  }

  let last = 0;
  const update = (value?: number | null): void => {
    if (value && value > last) {
      last = value;
    }
  };

  for (const message of getVisibleSessionMessages(session)) {
    update(message.updatedAt || message.createdAt);
  }
  for (const activity of session.activities.filter((entry) => isPrivateProjectActivity(entry))) {
    update(activity.updatedAt || activity.createdAt);
  }
  for (const entry of session.cliTrace) {
    update(entry.createdAt);
  }
  for (const item of session.queue.filter((entry) => entry.source !== "workgroup")) {
    update(item.queuedAt);
  }
  if (session.currentSource !== "workgroup") {
    update(session.currentStartedAt ?? null);
  }

  return last;
}

function getWorkgroupLastActivityAt(workgroupId: string): number {
  const summary = state.workgroups.find((entry) => entry.id === workgroupId) ?? null;
  const session = state.sessionsByWorkgroupId.get(workgroupId) ?? null;
  if (!session) {
    return summary?.updatedAt ?? 0;
  }

  let last = Math.max(session.updatedAt || 0, summary?.updatedAt ?? 0);
  for (const message of session.messages) {
    const value = message.updatedAt || message.createdAt;
    if (value > last) {
      last = value;
    }
  }
  return last;
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

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(getLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return inlineText("Just now", "刚刚");
  }
  const diffMs = Math.max(0, Date.now() - timestamp);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs < minuteMs) {
    return inlineText("Just now", "刚刚");
  }
  if (diffMs < hourMs) {
    const minutes = Math.max(1, Math.floor(diffMs / minuteMs));
    return inlineText(`${minutes}m ago`, `${minutes}分钟前`);
  }
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.floor(diffMs / hourMs));
    return inlineText(`${hours}h ago`, `${hours}小时前`);
  }
  const days = Math.max(1, Math.floor(diffMs / dayMs));
  return inlineText(`${days}d ago`, `${days}天前`);
}

function getProjectLatestPreview(projectId: string): string {
  const project = state.projects.find((entry) => entry.id === projectId) ?? null;
  const session = state.sessionsByProjectId.get(projectId) ?? null;
  return projectRuntimeRules.buildProjectLatestPreview({
    project,
    session,
    inlineText,
    msg,
    providerLabel,
    modelLabel,
    translateSource,
    translateKind,
    translateCliStream,
    translateActivityStatus,
    previewText,
    maxLength: 96,
  });
}

function getWorkgroupLatestPreview(workgroupId: string): string {
  const session = state.sessionsByWorkgroupId.get(workgroupId) ?? null;
  const summary = state.workgroups.find((entry) => entry.id === workgroupId) ?? null;
  const latestMessage = session?.messages[session.messages.length - 1] ?? null;
  if (latestMessage?.content?.trim()) {
    return previewText(latestMessage.content, 96) || getWorkgroupStatusMeta(workgroupId).detail;
  }
  const summaryPreview = summary?.lastMessagePreview?.trim();
  if (summaryPreview) {
    return previewText(summaryPreview, 96) || getWorkgroupStatusMeta(workgroupId).detail;
  }
  return getWorkgroupStatusMeta(workgroupId).detail;
}

function getPreferredSidebarSelection(): { projectId: string | null; workgroupId: string | null } | null {
  const entries: Array<{
    projectId: string | null;
    workgroupId: string | null;
    lastActivityAt: number;
    sortName: string;
  }> = [
    ...state.projects.map((project) => ({
      projectId: project.id,
      workgroupId: null,
      lastActivityAt: getProjectLastActivityAt(project.id),
      sortName: project.name,
    })),
    ...state.workgroups.map((workgroup) => ({
      projectId: null,
      workgroupId: workgroup.id,
      lastActivityAt: getWorkgroupLastActivityAt(workgroup.id),
      sortName: workgroup.name,
    })),
  ];

  if (entries.length === 0) {
    return null;
  }

  entries.sort((left, right) => {
    const activityDiff = right.lastActivityAt - left.lastActivityAt;
    if (activityDiff !== 0) {
      return activityDiff;
    }
    return left.sortName.localeCompare(right.sortName, getLocale(), { sensitivity: "base" });
  });

  const preferred = entries[0];
  return {
    projectId: preferred.projectId,
    workgroupId: preferred.workgroupId,
  };
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

  return inlineText("Please inspect the attached files.", "请查看我附上的文件。");
}

function buildComposerPrompt(rawPrompt: string, attachments: AttachmentRef[]): string {
  const trimmed = rawPrompt.trim();
  const prompt = trimmed || buildAttachmentOnlyPrompt(attachments);
  if (!trimmed || prompt.startsWith("/") || state.composerRunMode === "normal") {
    return prompt;
  }
  const command = state.composerRunMode === "plan" ? "/plan" : "/goal";
  return `${command} ${prompt}`;
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

function cloneAttachmentRefs(attachments: AttachmentRef[]): AttachmentRef[] {
  return attachments.map((attachment) => ({ ...attachment }));
}

function getProjectWorkspaceKey(projectId: string | null): string | null {
  return projectId ? `project:${projectId}` : null;
}

function getWorkgroupWorkspaceKey(workgroupId: string | null): string | null {
  return workgroupId ? `workgroup:${workgroupId}` : null;
}

function getCurrentWorkspaceKey(): string | null {
  if (state.projectId) {
    return getProjectWorkspaceKey(state.projectId);
  }
  if (state.workgroupId) {
    return getWorkgroupWorkspaceKey(state.workgroupId);
  }
  return null;
}

function getCurrentMessagesViewportKey(): string | null {
  if (state.workgroupId) {
    return `workgroup:${state.workgroupId}`;
  }
  if (state.projectId) {
    return `project:${state.projectId}:conversation:${getCurrentSession()?.activeConversationId ?? "default"}`;
  }
  return null;
}

function getCurrentActivityViewportKey(): string | null {
  if (!state.projectId) {
    return null;
  }
  return `project:${state.projectId}:activity:${getCurrentSession()?.activeConversationId ?? "default"}`;
}

function focusComposerAtEnd(): void {
  window.requestAnimationFrame(() => {
    const input = elements.composerInput;
    if (!input) {
      return;
    }
    input.focus();
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
  });
}

function syncComposerInputHeight(): void {
  const input = elements.composerInput;
  if (!input) {
    return;
  }
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  input.style.overflowY = input.scrollHeight > 220 ? "auto" : "hidden";
}

function getSpeechRecognitionConstructor(): any | null {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function updateVoiceInputButton(): void {
  const button = elements.voiceInputBtn;
  const modeSelect = elements.voiceInputModeSelect;
  if (modeSelect) {
    modeSelect.value = voiceInputMode;
    modeSelect.title = inlineText("Voice input mode", "语音输入模式");
    const transcribeOption = modeSelect.querySelector('option[value="transcribe"]');
    const sendOption = modeSelect.querySelector('option[value="send"]');
    if (transcribeOption) {
      transcribeOption.textContent = inlineText("Text", "转文字");
    }
    if (sendOption) {
      sendOption.textContent = inlineText("Send", "直接发");
    }
  }
  if (!button) {
    return;
  }
  const supported = Boolean(getSpeechRecognitionConstructor());
  button.disabled = !supported;
  button.classList.toggle("listening", isVoiceListening);
  button.textContent = isVoiceListening
    ? inlineText("Listening", "正在听")
    : inlineText("Voice", "语音");
  button.title = supported
    ? (voiceInputMode === "send"
      ? inlineText("Voice input: send directly", "语音输入：直接发送")
      : inlineText("Voice input: transcribe to text", "语音输入：转成文字"))
    : inlineText("Voice input is not supported in this desktop runtime.", "当前桌面运行环境不支持语音输入。");
}

function insertComposerText(text: string): void {
  const input = elements.composerInput;
  const normalized = text.trim();
  if (!input || !normalized) {
    return;
  }

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const prefix = before && !/\s$/u.test(before) ? " " : "";
  const suffix = after && !/^\s/u.test(after) ? " " : "";
  const insertion = prefix + normalized + suffix;
  input.value = before + insertion + after;
  const caret = before.length + insertion.length;
  input.setSelectionRange(caret, caret);
  input.focus();
  syncComposerInputHeight();
  persistWorkspaceDraft(getCurrentWorkspaceKey());
  refreshMentionSuggestions();
}

async function sendVoiceTranscript(transcript: string): Promise<void> {
  const prompt = transcript.trim();
  if (!prompt) {
    return;
  }
  if (state.workgroupId) {
    if (!api.sendWorkgroupCollaborationMessage) {
      insertComposerText(prompt);
      return;
    }
    const result = await api.sendWorkgroupCollaborationMessage({
      workgroupId: state.workgroupId,
      content: prompt,
    });
    if (!result.success) {
      insertComposerText(prompt);
      setHintText(result.error ?? inlineText("Failed to send voice message.", "语音消息发送失败。"), true);
      return;
    }
    setHintText(inlineText("Voice message sent.", "语音消息已发送。"), false);
    return;
  }
  if (!state.projectId) {
    insertComposerText(prompt);
    return;
  }
  const session = getCurrentSession();
  setHintText(
    session?.isRunning
      ? inlineText("Voice prompt queued behind the current run.", "语音提示词已排队等待当前任务完成。")
      : inlineText("Voice prompt sent.", "语音提示词已发送。"),
    false,
  );
  const result = await api.sendProjectPrompt({
    projectId: state.projectId,
    prompt: buildComposerPrompt(prompt, []),
    attachments: [],
    reasoningEffort: getComposerReasoningEffortForSend(),
  });
  if (!result.success) {
    insertComposerText(prompt);
    setHintText(result.error ?? inlineText("Failed to send voice prompt.", "语音提示词发送失败。"), true);
  }
}

function stopVoiceInput(): void {
  if (!activeSpeechRecognition) {
    return;
  }
  try {
    activeSpeechRecognition.stop();
  } catch {
    activeSpeechRecognition = null;
    isVoiceListening = false;
    updateVoiceInputButton();
  }
}

function readVoiceInputMode(): VoiceInputMode {
  const value = readStorageJson<VoiceInputMode>(storageKeys.voiceInputMode, "transcribe");
  return value === "send" ? "send" : "transcribe";
}

function persistVoiceInputMode(): void {
  writeStorageJson(storageKeys.voiceInputMode, voiceInputMode);
}

voiceInputMode = readVoiceInputMode();

function startVoiceInput(): void {
  if (isVoiceListening) {
    stopVoiceInput();
    return;
  }

  const Recognition = getSpeechRecognitionConstructor();
  if (!Recognition) {
    setHintText(inlineText("Voice input is not supported in this desktop runtime.", "当前桌面运行环境不支持语音输入。"), true);
    updateVoiceInputButton();
    return;
  }

  const recognition = new Recognition();
  activeSpeechRecognition = recognition;
  recognition.lang = state.lang === "zh" ? "zh-CN" : "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;
  let finalTranscript = "";
  let latestTranscript = "";
  recognition.onstart = () => {
    isVoiceListening = true;
    updateVoiceInputButton();
    setHintText(inlineText("Listening... speak now.", "正在听，请开始说话。"), false);
  };
  recognition.onresult = (event: any) => {
    let interimTranscript = "";
    for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = String(result?.[0]?.transcript ?? "").trim();
      if (!transcript) {
        continue;
      }
      latestTranscript = transcript;
      if (result.isFinal) {
        finalTranscript = (finalTranscript + " " + transcript).trim();
      } else {
        interimTranscript = transcript;
      }
    }
    if (interimTranscript) {
      setHintText(inlineText("Listening: " + interimTranscript, "正在听：" + interimTranscript), false);
    }
  };
  recognition.onerror = (event: any) => {
    const code = String(event?.error ?? "");
    const isNoSpeech = code === "no-speech" || code === "aborted";
    setHintText(
      isNoSpeech
        ? inlineText("No voice was captured.", "没有识别到语音。")
        : inlineText("Voice input failed: " + (code || "unknown error"), "语音输入失败：" + (code || "未知错误")),
      !isNoSpeech,
    );
  };
  recognition.onend = () => {
    const transcript = finalTranscript || latestTranscript;
    if (transcript) {
      if (voiceInputMode === "send") {
        void sendVoiceTranscript(transcript);
      } else {
        insertComposerText(transcript);
        setHintText(inlineText("Voice text added to the input.", "语音内容已加入输入框。"), false);
      }
    }
    activeSpeechRecognition = null;
    isVoiceListening = false;
    updateVoiceInputButton();
  };
  recognition.start();
}

function scrollMessagesToBottom(): void {
  if (!elements.messages) {
    return;
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
  updateMessagesJumpButtonVisibility();
}

function scheduleMessagesScrollToBottom(): void {
  if (pendingMessagesScrollFrame !== null) {
    window.cancelAnimationFrame(pendingMessagesScrollFrame);
    pendingMessagesScrollFrame = null;
  }
  if (pendingMessagesScrollTimeout !== null) {
    window.clearTimeout(pendingMessagesScrollTimeout);
    pendingMessagesScrollTimeout = null;
  }

  scrollMessagesToBottom();
  pendingMessagesScrollFrame = window.requestAnimationFrame(() => {
    scrollMessagesToBottom();
    pendingMessagesScrollFrame = window.requestAnimationFrame(() => {
      scrollMessagesToBottom();
      pendingMessagesScrollFrame = null;
    });
  });
  pendingMessagesScrollTimeout = window.setTimeout(() => {
    scrollMessagesToBottom();
    pendingMessagesScrollTimeout = null;
  }, 80);
}

function scrollActivitiesToBottom(): void {
  if (!elements.activityList) {
    return;
  }
  elements.activityList.scrollTop = elements.activityList.scrollHeight;
}

function scheduleActivitiesScrollToBottom(): void {
  if (pendingActivityScrollFrame !== null) {
    window.cancelAnimationFrame(pendingActivityScrollFrame);
    pendingActivityScrollFrame = null;
  }
  if (pendingActivityScrollTimeout !== null) {
    window.clearTimeout(pendingActivityScrollTimeout);
    pendingActivityScrollTimeout = null;
  }

  scrollActivitiesToBottom();
  pendingActivityScrollFrame = window.requestAnimationFrame(() => {
    scrollActivitiesToBottom();
    pendingActivityScrollFrame = window.requestAnimationFrame(() => {
      scrollActivitiesToBottom();
      pendingActivityScrollFrame = null;
    });
  });
  pendingActivityScrollTimeout = window.setTimeout(() => {
    scrollActivitiesToBottom();
    pendingActivityScrollTimeout = null;
  }, 80);
}

function isMessagesNearBottom(): boolean {
  if (!elements.messages) {
    return true;
  }
  return elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < 80;
}

function updateMessagesJumpButtonVisibility(): void {
  if (!elements.messagesJumpButton) {
    return;
  }
  const hasSelection = Boolean(state.projectId || state.workgroupId);
  const shouldShow = hasSelection && !isMessagesNearBottom();
  elements.messagesJumpButton.classList.toggle("hidden", !shouldShow);
}

function isActivityNearBottom(): boolean {
  if (!elements.activityList) {
    return true;
  }
  return elements.activityList.scrollHeight - elements.activityList.scrollTop - elements.activityList.clientHeight < 80;
}

function updateActivityJumpButtonVisibility(): void {
  if (!elements.activityJumpButton) {
    return;
  }
  const shouldShow = state.activeView === "activity" && Boolean(state.projectId) && !isActivityNearBottom();
  elements.activityJumpButton.classList.toggle("hidden", !shouldShow);
}

function getVisibleMessageContentById(messageId: string): string {
  if (state.workgroupId) {
    const message = getVisibleWorkgroupMessages().find((entry) => entry.id === messageId);
    return message?.content ?? "";
  }
  const message = getVisibleProjectMessages().find((entry) => entry.id === messageId);
  return message?.content ?? "";
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "true");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    fallback.style.pointerEvents = "none";
    document.body.appendChild(fallback);
    fallback.focus();
    fallback.select();
    try {
      return document.execCommand("copy");
    } finally {
      fallback.remove();
    }
  }
}

let temporaryAccessContextMenu: HTMLElement | null = null;
let temporaryAccessDialog: HTMLElement | null = null;

function closeTemporaryAccessContextMenu(): void {
  temporaryAccessContextMenu?.remove();
  temporaryAccessContextMenu = null;
}

function closeTemporaryAccessDialog(): void {
  temporaryAccessDialog?.remove();
  temporaryAccessDialog = null;
}

function getProjectById(projectId: string): ProjectState | null {
  return state.projects.find((project) => project.id === projectId) ?? null;
}

function showTemporaryAccessContextMenu(project: ProjectState, clientX: number, clientY: number): void {
  closeTemporaryAccessContextMenu();
  const menu = document.createElement("div");
  menu.className = "temporary-access-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = [
    `<button type="button" class="temporary-access-menu-item" data-share-temp-api="${escapeHtml(project.id)}">${escapeHtml(inlineText("Share temporary API", "分享临时 API"))}</button>`,
  ].join("");
  document.body.appendChild(menu);
  const viewportPadding = 12;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(viewportPadding, Math.min(clientX, window.innerWidth - rect.width - viewportPadding))}px`;
  menu.style.top = `${Math.max(viewportPadding, Math.min(clientY, window.innerHeight - rect.height - viewportPadding))}px`;
  menu.querySelector("[data-share-temp-api]")?.addEventListener("click", () => {
    closeTemporaryAccessContextMenu();
    openTemporaryAccessDialog(project);
  });
  temporaryAccessContextMenu = menu;
}

function openTemporaryAccessDialog(project: ProjectState): void {
  if (!api.createTemporaryAccessLink) {
    setHintText(inlineText("Current desktop build does not support temporary API sharing.", "当前桌面版本不支持临时 API 分享。"), true);
    return;
  }
  closeTemporaryAccessDialog();
  const dialog = document.createElement("div");
  dialog.className = "temporary-access-dialog";
  dialog.innerHTML = [
    '<div class="temporary-access-backdrop" data-close-temp-access="1"></div>',
    '<form class="temporary-access-card">',
    '<div class="temporary-access-header">',
    `<div><strong>${escapeHtml(inlineText("Share temporary API", "分享临时 API"))}</strong><span>${escapeHtml(project.name)}</span></div>`,
    '<button type="button" class="temporary-access-close" data-close-temp-access="1">×</button>',
    '</div>',
    `<p class="temporary-access-desc">${escapeHtml(inlineText("Create a limited-use link for this project. The receiver must log in before redeeming it.", "为当前项目生成限次限时链接，对方登录后才能兑换授权。"))}</p>`,
    '<label class="temporary-access-field">',
    `<span>${escapeHtml(inlineText("Call limit", "调用次数"))}</span>`,
    '<input name="maxUses" type="number" min="1" max="1000" value="3" required>',
    '</label>',
    '<label class="temporary-access-field">',
    `<span>${escapeHtml(inlineText("Expires in hours", "有效小时数"))}</span>`,
    '<input name="expiresInHours" type="number" min="1" max="720" value="24" required>',
    '</label>',
    '<label class="temporary-access-field">',
    `<span>${escapeHtml(inlineText("Note", "备注"))}</span>`,
    `<input name="note" type="text" maxlength="120" value="${escapeHtml(project.name)}">`,
    '</label>',
    '<div class="temporary-access-result hidden" data-temp-access-result>',
    '<textarea readonly data-temp-access-url></textarea>',
    `<button type="button" class="ghost-button" data-copy-temp-access>${escapeHtml(inlineText("Copy again", "再次复制"))}</button>`,
    '</div>',
    '<div class="temporary-access-actions">',
    `<button type="button" class="ghost-button" data-close-temp-access="1">${escapeHtml(inlineText("Cancel", "取消"))}</button>`,
    `<button type="submit" class="primary-button" data-temp-access-submit>${escapeHtml(inlineText("Create and copy", "生成并复制"))}</button>`,
    '</div>',
    '</form>',
  ].join("");
  document.body.appendChild(dialog);
  temporaryAccessDialog = dialog;

  dialog.querySelectorAll("[data-close-temp-access]").forEach((node) => {
    node.addEventListener("click", () => closeTemporaryAccessDialog());
  });

  dialog.querySelector("[data-copy-temp-access]")?.addEventListener("click", () => {
    const value = (dialog.querySelector("[data-temp-access-url]") as HTMLTextAreaElement | null)?.value ?? "";
    void copyTextToClipboard(value).then((copied) => {
      setHintText(copied ? inlineText("Temporary API link copied.", "临时 API 链接已复制。") : inlineText("Failed to copy temporary API link.", "复制临时 API 链接失败。"), !copied);
    });
  });

  dialog.querySelector("form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createTemporaryAccessLinkFromDialog(project, dialog);
  });
}

async function createTemporaryAccessLinkFromDialog(project: ProjectState, dialog: HTMLElement): Promise<void> {
  const form = dialog.querySelector("form") as HTMLFormElement | null;
  const submitButton = dialog.querySelector("[data-temp-access-submit]") as HTMLButtonElement | null;
  if (!form || !api.createTemporaryAccessLink) {
    return;
  }
  const formData = new FormData(form);
  const maxUses = Number(formData.get("maxUses") ?? 0);
  const expiresInHours = Number(formData.get("expiresInHours") ?? 0);
  if (!Number.isFinite(maxUses) || maxUses <= 0 || !Number.isFinite(expiresInHours) || expiresInHours <= 0) {
    setHintText(inlineText("Call limit and expiry must be greater than zero.", "调用次数和有效期必须大于 0。"), true);
    return;
  }
  submitButton?.setAttribute("disabled", "true");
  const result = await api.createTemporaryAccessLink({
    targetAgentId: project.isRemote ? project.agentId ?? null : null,
    projectIds: [project.id],
    scopeType: "selected_projects",
    capabilityBundle: "collaborate",
    allowFileDownload: true,
    allowDiagnostics: true,
    maxUses,
    expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
    note: String(formData.get("note") ?? "").trim(),
  });
  submitButton?.removeAttribute("disabled");
  if (!result.success) {
    setHintText(result.error ?? inlineText("Failed to create temporary API link.", "生成临时 API 链接失败。"), true);
    return;
  }
  const url = result.url || result.apiUrl || "";
  const textarea = dialog.querySelector("[data-temp-access-url]") as HTMLTextAreaElement | null;
  const resultBox = dialog.querySelector("[data-temp-access-result]") as HTMLElement | null;
  if (textarea) {
    textarea.value = url;
  }
  resultBox?.classList.remove("hidden");
  const copied = await copyTextToClipboard(url);
  setHintText(copied ? inlineText("Temporary API link created and copied.", "临时 API 链接已生成并复制。") : inlineText("Temporary API link created. Copy it from the dialog.", "临时 API 链接已生成，请在弹窗中复制。"), !copied);
}

async function copyVisibleMessage(messageId: string): Promise<void> {
  const content = getVisibleMessageContentById(messageId);
  if (!content.trim()) {
    setHintText(inlineText("Nothing to copy from this message.", "这条消息没有可复制的内容。"), true);
    return;
  }

  const copied = await copyTextToClipboard(content);
  setHintText(
    copied
      ? inlineText("Message copied to clipboard.", "消息已复制到剪贴板。")
      : inlineText("Failed to copy the message.", "复制消息失败。"),
    !copied,
  );
}

function getVisibleActivityDetailById(activityId: string): string {
  const activity = getDisplayedActivities().find((entry) => entry.id === activityId);
  if (!activity) {
    return "";
  }
  return [activity.title, activity.detail].filter((entry) => entry.trim()).join("\n\n");
}

async function copyVisibleActivity(activityId: string): Promise<void> {
  const content = getVisibleActivityDetailById(activityId);
  if (!content.trim()) {
    setHintText(inlineText("Nothing to copy from this activity.", "这条活动没有可复制的内容。"), true);
    return;
  }

  const copied = await copyTextToClipboard(content);
  setHintText(
    copied
      ? inlineText("Activity copied to clipboard.", "活动内容已复制到剪贴板。")
      : inlineText("Failed to copy the activity.", "复制活动内容失败。"),
    !copied,
  );
}

function persistWorkspaceDraft(workspaceKey: string | null): void {
  if (!workspaceKey || !elements.composerInput) {
    return;
  }

  const text = elements.composerInput.value;
  const attachments = cloneAttachmentRefs(state.pendingAttachments);
  if (!text && attachments.length === 0) {
    state.draftsByWorkspaceKey.delete(workspaceKey);
    return;
  }

  state.draftsByWorkspaceKey.set(workspaceKey, {
    text,
    attachments,
  });
}

function clearWorkspaceDraft(workspaceKey: string | null): void {
  if (!workspaceKey) {
    return;
  }
  state.draftsByWorkspaceKey.delete(workspaceKey);
}

function restoreWorkspaceDraft(workspaceKey: string | null): void {
  const draft = workspaceKey ? state.draftsByWorkspaceKey.get(workspaceKey) ?? null : null;
  if (elements.composerInput) {
    elements.composerInput.value = draft?.text ?? "";
  }
  state.pendingAttachments = draft ? cloneAttachmentRefs(draft.attachments) : [];
  state.attachmentPreview = null;
  syncComposerInputHeight();
  renderPendingAttachments();
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
  return "messages";
}

function buildProjectCatalogSignature(projects: ProjectState[]): string {
  return [...projects]
    .sort((left, right) => left.id.localeCompare(right.id, "en-US"))
    .map((project) => [
      project.id,
      project.agentId ?? "",
      project.name,
      project.path,
      project.groupName ?? "",
      project.cliProvider,
      project.cliModel ?? "",
      project.online === false ? "0" : "1",
      project.isRemote ? "1" : "0",
    ].join("|"))
    .join("||");
}

function buildWorkgroupSummarySignature(workgroups: WorkgroupSummary[]): string {
  return [...workgroups]
    .sort((left, right) => left.id.localeCompare(right.id, "en-US"))
    .map((workgroup) => [
      workgroup.id,
      workgroup.name,
      workgroup.description ?? "",
      String(workgroup.updatedAt || 0),
      workgroup.isRunning ? "1" : "0",
      workgroup.lastMessagePreview ?? "",
      String(workgroup.messageCount || 0),
      String(workgroup.memberCount || 0),
    ].join("|"))
    .join("||");
}

function buildSessionSnapshotSignature(snapshot: SessionSnapshot): string {
  const latestMessage = snapshot.messages[snapshot.messages.length - 1];
  const latestActivity = snapshot.activities[snapshot.activities.length - 1];
  const latestCli = snapshot.cliTrace[snapshot.cliTrace.length - 1];
  const latestQueue = snapshot.queue[snapshot.queue.length - 1];
  const activeConversation = snapshot.conversations.find((conversation) => conversation.isActive);
  return [
    snapshot.projectId,
    snapshot.provider,
    snapshot.model ?? "",
    snapshot.isRunning ? "1" : "0",
    String(snapshot.queuedCount || 0),
    snapshot.currentSource ?? "",
    buildPromptSignature(snapshot.currentPrompt),
    String(snapshot.currentStartedAt ?? 0),
    snapshot.activeConversationId ?? "",
    activeConversation?.title ?? "",
    String(snapshot.messageTotal || 0),
    String(snapshot.activityTotal || 0),
    String(snapshot.cliTraceTotal || 0),
    latestMessage?.id ?? "",
    String(latestMessage?.updatedAt || latestMessage?.createdAt || 0),
    latestMessage?.status ?? "",
    latestActivity?.id ?? "",
    String(latestActivity?.updatedAt || latestActivity?.createdAt || 0),
    latestActivity?.status ?? "",
    latestCli?.id ?? "",
    String(latestCli?.createdAt || 0),
    latestQueue?.runId ?? "",
    String(latestQueue?.queuedAt || 0),
  ].join("|");
}

function buildPromptSignature(prompt: string | null | undefined): string {
  const normalized = (prompt ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= 96) {
    return normalized;
  }
  return `${normalized.slice(0, 48)}|${normalized.length}|${normalized.slice(-24)}`;
}

function buildWorkgroupSessionSnapshotSignature(snapshot: WorkgroupSessionSnapshot): string {
  const latestMessage = snapshot.messages[snapshot.messages.length - 1];
  const runningMemberIds = snapshot.members
    .filter((member) => member.isRunning)
    .map((member) => member.id)
    .sort()
    .join(",");
  return [
    snapshot.workgroupId,
    snapshot.workgroupName,
    snapshot.description ?? "",
    snapshot.allowDirectMemberMessages ? "1" : "0",
    String(snapshot.updatedAt || 0),
    snapshot.isRunning ? "1" : "0",
    String(snapshot.messageTotal || 0),
    String(snapshot.members.length),
    runningMemberIds,
    latestMessage?.id ?? "",
    String(latestMessage?.updatedAt || latestMessage?.createdAt || 0),
    latestMessage?.status ?? "",
  ].join("|");
}

function isWorkgroupSelected(): boolean {
  return Boolean(state.workgroupId);
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

function getCurrentWorkgroup(): WorkgroupSummary | null {
  return state.workgroups.find((workgroup) => workgroup.id === state.workgroupId) ?? null;
}

function getCurrentWorkgroupSession(): WorkgroupSessionSnapshot | null {
  if (!state.workgroupId) {
    return null;
  }
  return state.sessionsByWorkgroupId.get(state.workgroupId) ?? null;
}

function getCurrentWorkspaceSearchKey(): string | null {
  if (state.workgroupId) {
    return `workgroup:${state.workgroupId}`;
  }
  if (state.projectId) {
    return `project:${state.projectId}`;
  }
  return null;
}

function createHistoryStateFromSnapshot(snapshot: SessionSnapshot): ProjectHistoryState {
  return {
    conversationId: snapshot.activeConversationId,
    messages: snapshot.messages.slice(),
    activities: limitRecentActivityItems(snapshot.activities),
    cliTrace: snapshot.cliTrace.slice(),
    hasMoreMessages: snapshot.messageTotal > snapshot.messages.length,
    hasMoreActivities: false,
    hasMoreCli: snapshot.cliTraceTotal > snapshot.cliTrace.length,
    loadingMessages: false,
    loadingActivities: false,
    loadingCli: false,
  };
}

function getProjectHistoryState(projectId: string): ProjectHistoryState | null {
  return state.historyByProjectId.get(projectId) ?? null;
}

function createWorkgroupHistoryStateFromSnapshot(snapshot: WorkgroupSessionSnapshot): WorkgroupHistoryState {
  return {
    messages: snapshot.messages.slice(),
    hasMoreMessages: snapshot.messageTotal > snapshot.messages.length,
    loadingMessages: false,
  };
}

function getWorkgroupHistoryState(workgroupId: string): WorkgroupHistoryState | null {
  return state.historyByWorkgroupId.get(workgroupId) ?? null;
}

function prependHistoryItems<T extends { id: string }>(currentItems: T[], olderItems: T[]): T[] {
  if (olderItems.length === 0) {
    return currentItems.slice();
  }
  if (currentItems.length === 0) {
    return olderItems.slice();
  }

  const currentItemsById = new Map(currentItems.map((item) => [item.id, item] as const));
  const merged: T[] = [];
  const seen = new Set<string>();

  for (const item of olderItems) {
    if (seen.has(item.id)) {
      continue;
    }
    merged.push(currentItemsById.get(item.id) ?? item);
    seen.add(item.id);
  }

  for (const item of currentItems) {
    if (seen.has(item.id)) {
      continue;
    }
    merged.push(item);
    seen.add(item.id);
  }

  return merged;
}

function appendLatestHistoryItems<T extends { id: string }>(currentItems: T[], latestItems: T[]): T[] {
  if (currentItems.length === 0) {
    return latestItems.slice();
  }
  if (latestItems.length === 0) {
    return currentItems.slice();
  }

  const latestItemsById = new Map(latestItems.map((item) => [item.id, item] as const));
  const merged: T[] = [];
  const seen = new Set<string>();

  for (const item of currentItems) {
    if (latestItemsById.has(item.id) || seen.has(item.id)) {
      continue;
    }
    merged.push(item);
    seen.add(item.id);
  }

  for (const item of latestItems) {
    if (seen.has(item.id)) {
      continue;
    }
    merged.push(item);
    seen.add(item.id);
  }

  return merged;
}

function syncHistoryStateFromSnapshot(snapshot: SessionSnapshot): void {
  const existing = state.historyByProjectId.get(snapshot.projectId);
  if (!existing || existing.conversationId !== snapshot.activeConversationId) {
    state.historyByProjectId.set(snapshot.projectId, createHistoryStateFromSnapshot(snapshot));
    return;
  }

  existing.messages = appendLatestHistoryItems(existing.messages, snapshot.messages);
  existing.activities = limitRecentActivityItems(appendLatestHistoryItems(existing.activities, snapshot.activities));
  existing.cliTrace = appendLatestHistoryItems(existing.cliTrace, snapshot.cliTrace);
  existing.hasMoreMessages = snapshot.messageTotal > existing.messages.length;
  existing.hasMoreActivities = false;
  existing.hasMoreCli = snapshot.cliTraceTotal > existing.cliTrace.length;
}

function syncWorkgroupHistoryStateFromSnapshot(snapshot: WorkgroupSessionSnapshot): void {
  const existing = state.historyByWorkgroupId.get(snapshot.workgroupId);
  if (!existing) {
    state.historyByWorkgroupId.set(snapshot.workgroupId, createWorkgroupHistoryStateFromSnapshot(snapshot));
    return;
  }

  if (snapshot.messages.length === 0) {
    existing.hasMoreMessages = snapshot.messageTotal > existing.messages.length;
    return;
  }
  existing.messages = appendLatestHistoryItems(existing.messages, snapshot.messages);
  existing.hasMoreMessages = snapshot.messageTotal > existing.messages.length;
}

function getDisplayedMessages(): SessionMessage[] {
  const projectId = state.projectId;
  if (!projectId) {
    return [];
  }
  const historyMessages = getProjectHistoryState(projectId)?.messages;
  if (historyMessages) {
    return historyMessages.filter((message) => isPrivateProjectMessage(message));
  }
  return getVisibleSessionMessages(getCurrentSession());
}

function getDisplayedWorkgroupMessages(): WorkgroupMessage[] {
  const workgroupId = state.workgroupId;
  if (!workgroupId) {
    return [];
  }
  return getWorkgroupHistoryState(workgroupId)?.messages ?? getCurrentWorkgroupSession()?.messages ?? [];
}

function getVisibleProjectMessages(): SessionMessage[] {
  const workspaceKey = getCurrentWorkspaceSearchKey();
  if (
    state.messageSearchQuery.trim()
    && workspaceKey
    && workspaceKey === state.messageSearchWorkspaceKey
    && Array.isArray(state.messageSearchProjectResults)
  ) {
    return state.messageSearchProjectResults;
  }
  return getDisplayedMessages();
}

function getVisibleWorkgroupMessages(): WorkgroupMessage[] {
  const workspaceKey = getCurrentWorkspaceSearchKey();
  if (
    state.messageSearchQuery.trim()
    && workspaceKey
    && workspaceKey === state.messageSearchWorkspaceKey
    && Array.isArray(state.messageSearchWorkgroupResults)
  ) {
    return state.messageSearchWorkgroupResults;
  }
  return getDisplayedWorkgroupMessages();
}

function getDisplayedActivities(): SessionActivity[] {
  const projectId = state.projectId;
  if (!projectId) {
    return [];
  }
  const activities = getProjectHistoryState(projectId)?.activities ?? getCurrentSession()?.activities ?? [];
  return limitRecentActivityItems(
    [...activities].sort((left, right) => {
    const leftCreatedAt = left.createdAt || left.updatedAt || 0;
    const rightCreatedAt = right.createdAt || right.updatedAt || 0;
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }
    const leftUpdatedAt = left.updatedAt || left.createdAt || 0;
    const rightUpdatedAt = right.updatedAt || right.createdAt || 0;
    if (leftUpdatedAt !== rightUpdatedAt) {
      return leftUpdatedAt - rightUpdatedAt;
    }
    return left.id.localeCompare(right.id, "en-US");
    }).filter((activity) => isPrivateProjectActivity(activity)),
  );
}

function limitRecentActivityItems<T>(items: T[]): T[] {
  if (items.length <= MAX_ACTIVITY_PANEL_ITEMS) {
    return items.slice();
  }
  return items.slice(-MAX_ACTIVITY_PANEL_ITEMS);
}

function getDisplayedCliTrace(): CliTraceEntry[] {
  const projectId = state.projectId;
  if (!projectId) {
    return [];
  }
  return getProjectHistoryState(projectId)?.cliTrace ?? getCurrentSession()?.cliTrace ?? [];
}

function clearHistoryAutoloadTimer(kind: "messages" | "activities" | "cli"): void {
  const timer = historyAutoloadTimers[kind];
  if (typeof timer === "number") {
    window.clearTimeout(timer);
    delete historyAutoloadTimers[kind];
  }
}

function scheduleHistoryAutoload(kind: "messages" | "activities" | "cli"): void {
  clearHistoryAutoloadTimer(kind);
  historyAutoloadTimers[kind] = window.setTimeout(() => {
    delete historyAutoloadTimers[kind];

    if (kind === "messages" && state.messageSearchQuery.trim()) {
      return;
    }

    if (state.workgroupId) {
      if (kind !== "messages") {
        return;
      }
      const historyState = getWorkgroupHistoryState(state.workgroupId);
      if (!historyState?.hasMoreMessages || historyState.loadingMessages || !elements.messages) {
        return;
      }
      if (elements.messages.scrollHeight > elements.messages.clientHeight + 24) {
        return;
      }
      void loadOlderHistory("messages");
      return;
    }

    if (!state.projectId) {
      return;
    }

    const historyState = getProjectHistoryState(state.projectId);
    if (!historyState) {
      return;
    }

    const hasMore = kind === "messages"
      ? historyState.hasMoreMessages
      : (kind === "activities" ? historyState.hasMoreActivities : historyState.hasMoreCli);
    const isLoading = kind === "messages"
      ? historyState.loadingMessages
      : (kind === "activities" ? historyState.loadingActivities : historyState.loadingCli);
    const container = kind === "messages"
      ? elements.messages
      : (kind === "activities" ? elements.activityList : elements.cliTrace);

    if (!hasMore || isLoading || !container) {
      return;
    }
    if (container.scrollHeight > container.clientHeight + 24) {
      return;
    }
    void loadOlderHistory(kind);
  }, 80);
}

function shouldStickToBottom(container: HTMLElement | null): boolean {
  if (!container) {
    return false;
  }
  const initialized = container.dataset.initialized === "true";
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  if (!initialized) {
    container.dataset.initialized = "true";
  }
  return !initialized || nearBottom;
}

function getLatestActivity(session: SessionSnapshot | null): SessionActivity | null {
  return projectRuntimeRules.getLatestActivity(session);
}

function getLatestCliEntry(session: SessionSnapshot | null): CliTraceEntry | null {
  return projectRuntimeRules.getLatestCliEntry(session);
}

function getLatestMessage(session: SessionSnapshot | null): SessionMessage | null {
  return projectRuntimeRules.getLatestMessage(session);
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

function getProjectStatusMeta(projectId: string): { label: string; tone: string; detail: string } {
  const project = state.projects.find((entry) => entry.id === projectId) ?? null;
  const session = state.sessionsByProjectId.get(projectId) ?? null;
  return projectRuntimeRules.buildProjectStatusMeta({
    project,
    session,
    inlineText,
    msg,
    providerLabel,
    modelLabel,
    translateSource,
    translateKind,
    translateCliStream,
    translateActivityStatus,
    previewText,
  });
}

function setActiveProject(projectId: string | null): void {
  const previousWorkspaceKey = getCurrentWorkspaceKey();
  const nextWorkspaceKey = getProjectWorkspaceKey(projectId);
  const selectionChanged = state.projectId !== projectId || Boolean(state.workgroupId);
  if (selectionChanged) {
    persistWorkspaceDraft(previousWorkspaceKey);
  }
  hideMentionSuggestions();
  state.projectId = projectId;
  state.workgroupId = null;
  if (selectionChanged) {
    state.forceDockScroll = "messages";
  }
  api.setActiveProject?.(projectId);
  if (!projectId) {
    api.setActiveWorkgroupCollaboration?.(null);
  }
  restoreWorkspaceDraft(nextWorkspaceKey);
}

function setActiveWorkgroup(workgroupId: string | null): void {
  const previousWorkspaceKey = getCurrentWorkspaceKey();
  const nextWorkspaceKey = getWorkgroupWorkspaceKey(workgroupId);
  const selectionChanged = state.workgroupId !== workgroupId || Boolean(state.projectId);
  if (selectionChanged) {
    persistWorkspaceDraft(previousWorkspaceKey);
  }
  hideMentionSuggestions();
  state.workgroupId = workgroupId;
  state.projectId = null;
  if (selectionChanged) {
    state.forceDockScroll = "messages";
  }
  api.setActiveProject?.(null);
  api.setActiveWorkgroupCollaboration?.(workgroupId);
  restoreWorkspaceDraft(nextWorkspaceKey);
}

function setSidebarMode(mode: SidebarListMode): void {
  if (state.sidebarMode === mode) {
    return;
  }
  state.sidebarMode = mode;
  if (!state.projectId && !state.workgroupId) {
    const preferred = getPreferredSidebarSelection();
    if (preferred?.workgroupId) {
      setActiveWorkgroup(preferred.workgroupId);
    } else if (preferred?.projectId) {
      setActiveProject(preferred.projectId);
    }
  }
  if (state.workgroupId) {
    state.activeView = "messages";
  } else {
    syncActiveViewForCurrentProject();
  }
  if (state.messageSearchQuery.trim()) {
    scheduleMessageSearch();
  }
  render();
}

function setActiveView(view: WorkspaceView, persistPreference = true): void {
  state.activeView = view;
  state.forceDockScroll = view;
  if (!persistPreference) {
    return;
  }

  const provider = getConfiguredProvider(getCurrentProject(), getCurrentSession());
  state.preferredViews[provider] = view;
}

function syncActiveViewForCurrentProject(): void {
  if (isWorkgroupSelected()) {
    state.activeView = "messages";
    return;
  }
  const provider = getConfiguredProvider(getCurrentProject(), getCurrentSession());
  state.activeView = state.preferredViews[provider] ?? defaultViewForProvider(provider);
  if (state.activeView !== "messages") {
    state.forceDockScroll = state.activeView;
  }
}

function updateDocumentTitle(): void {
  const workgroup = getCurrentWorkgroup();
  if (workgroup) {
    document.title = `${workgroup.name} - ${inlineText("Collaboration", "协作")}`;
    return;
  }

  const project = getCurrentProject();
  if (project) {
    document.title = `${project.name} - ${msg("terminal.sessionSuffix", "Session")}`;
    return;
  }

  document.title = msg("terminal.defaultTitle", "Project Session");
}

function syncDocumentTitleIfNeeded(): void {
  const previousTitle = document.title;
  updateDocumentTitle();
  if (lastDocumentTitle === document.title) {
    return;
  }
  lastDocumentTitle = document.title;
  if (previousTitle === document.title) {
    return;
  }
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
  const markup = hasItems
    ? state.pendingAttachments.map((attachment) => renderAttachmentChipView(attachment)).join("")
    : "";
  const signature = `${hasItems ? "1" : "0"}|${markup}`;
  if (renderSignatures.attachments !== signature) {
    renderSignatures.attachments = signature;
    elements.attachmentTray.classList.toggle("has-items", hasItems);
    elements.attachmentTray.innerHTML = markup;
  }
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
      setHintText(result.error ?? inlineText("Failed to load image preview.", "Failed to load image preview."), true);
      return;
    }
    dataUrl = result.dataUrl;
  }

  if (!dataUrl) {
    setHintText(inlineText("Image preview is unavailable.", "Image preview is unavailable."), true);
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
  if (!supportsDesktopCapability("clipboardImagePaste") || !state.projectId || !api.saveClipboardProjectImage) {
    return;
  }

  const result = await api.saveClipboardProjectImage({ projectId: state.projectId });
  if (!result.success || !result.attachment) {
    setHintText(result.error ?? inlineText("Failed to paste image from clipboard.", "Failed to paste image from clipboard."), true);
    return;
  }

  state.pendingAttachments = mergeAttachments(state.pendingAttachments, [result.attachment]);
  persistWorkspaceDraft(getCurrentWorkspaceKey());
  renderPendingAttachments();
  setHintText(
    inlineText(
      `${state.pendingAttachments.length} attachment(s) ready to send.`,
      `已有 ${state.pendingAttachments.length} 个附件待发送。`,
    ),
    false,
  );
}

function applyStaticI18n(): void {
  document.documentElement.lang = state.lang;

  if (elements.projectsTitle) {
    elements.projectsTitle.textContent = inlineText("Messages", "消息");
  }
  if (elements.projectSearchInput) {
    elements.projectSearchInput.placeholder = inlineText("Search messages", "搜索消息");
  }
  if (elements.sidebarProjectsTabLabel) {
    elements.sidebarProjectsTabLabel.textContent = inlineText("Messages", "消息");
  }
  if (elements.sidebarWorkgroupsTabLabel) {
    elements.sidebarWorkgroupsTabLabel.textContent = inlineText("Contacts", "通讯录");
  }
  if (elements.messageSearchInput) {
    elements.messageSearchInput.placeholder = inlineText("Search messages", "搜索消息");
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
  updateVoiceInputButton();
  if (elements.messagesJumpButton) {
    const label = inlineText("Latest", "最新消息");
    elements.messagesJumpButton.textContent = label;
    elements.messagesJumpButton.title = inlineText("Jump to the latest message", "跳转到最新消息");
  }
  if (elements.activityJumpButton) {
    const label = inlineText("Latest", "最新活动");
    elements.activityJumpButton.textContent = label;
    elements.activityJumpButton.title = inlineText("Jump to the latest activity", "跳转到最新活动");
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
    const settingsLabel = inlineText("System", "系统");
    elements.settingsBtn.textContent = settingsLabel;
    elements.settingsBtn.title = settingsLabel;
  }
  if (elements.serverSettingsBtn) {
    const serverLabel = inlineText("Server", "服务器");
    elements.serverSettingsBtn.textContent = serverLabel;
    elements.serverSettingsBtn.title = inlineText("Server Connection", "服务器连接");
  }
  if (elements.projectSettingsBtn) {
    const projectLabel = inlineText("Projects", "项目");
    elements.projectSettingsBtn.textContent = projectLabel;
    elements.projectSettingsBtn.title = inlineText("Project Settings", "项目设置");
  }
  if (elements.closeBtn) {
    elements.closeBtn.title = msg("common.close", "Close");
  }
}

function renderSidebarModeControls(): void {
  if (elements.projectsTitle) {
    elements.projectsTitle.textContent = state.sidebarMode === "contacts"
      ? inlineText("Contacts", "通讯录")
      : inlineText("Messages", "消息");
  }
  if (elements.projectSearchInput) {
    elements.projectSearchInput.placeholder = state.sidebarMode === "contacts"
      ? inlineText("Search contacts", "搜索通讯录")
      : inlineText("Search messages", "搜索消息");
  }
  elements.sidebarProjectsTab?.classList.toggle("active", state.sidebarMode === "messages");
  elements.sidebarProjectsTab?.setAttribute("aria-pressed", String(state.sidebarMode === "messages"));
  elements.sidebarWorkgroupsTab?.classList.toggle("active", state.sidebarMode === "contacts");
  elements.sidebarWorkgroupsTab?.setAttribute("aria-pressed", String(state.sidebarMode === "contacts"));
}

function buildOverviewState(
  project: ProjectState | null,
  session: SessionSnapshot | null,
  provider: "claude" | "codex",
): OverviewState {
  return projectRuntimeRules.buildOverviewState({
    project,
    session,
    provider,
    inlineText,
    msg,
    providerLabel,
    modelLabel,
    translateSource,
    translateKind,
    translateCliStream,
    translateActivityStatus,
    previewText,
  });
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
  const workgroupSelected = isWorkgroupSelected();
  const activityCount = session?.activities.length ?? 0;
  const queueCount = session?.queue.length ?? 0;
  const cliRunning = Boolean(session?.isRunning);
  const showDock = Boolean(state.projectId) && !workgroupSelected && state.activeView !== "messages";
  const signature = [
    state.lang,
    state.projectId ?? "",
    state.workgroupId ?? "",
    state.activeView,
    showDock ? "1" : "0",
    workgroupSelected ? "1" : "0",
    String(activityCount),
    String(queueCount),
    cliRunning ? "1" : "0",
  ].join("|");
  if (renderSignatures.workbench === signature) {
    return;
  }
  renderSignatures.workbench = signature;
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
  if (elements.activityTab) {
    elements.activityTab.hidden = workgroupSelected;
  }
  if (elements.cliTab) {
    elements.cliTab.hidden = workgroupSelected;
  }
  if (elements.queueTab) {
    elements.queueTab.hidden = workgroupSelected;
  }
  if (elements.detailDock) {
    elements.detailDock.classList.toggle("is-open", showDock);
  }
  if (elements.messagesView) {
    elements.messagesView.classList.toggle("is-hidden", showDock);
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
  const queuedItems = (session?.queue ?? []).filter((item) => item.source !== "workgroup");
  elements.queueCount.textContent = String(queuedItems.length);

  if (!project) {
    const markup = formatEmptyState(
      msg("terminal.empty.selectProjectTitle", "No project selected"),
      msg("terminal.empty.selectProjectDetail", "Choose a project from the left sidebar to view messages."),
    );
    if (renderSignatures.queue !== markup) {
      renderSignatures.queue = markup;
      elements.queueList.innerHTML = markup;
    }
    return;
  }

  if (queuedItems.length === 0) {
    const markup = renderDockBlank();
    if (renderSignatures.queue !== markup) {
      renderSignatures.queue = markup;
      elements.queueList.innerHTML = markup;
    }
    return;
  }

  const forceScroll = state.forceDockScroll === "queue";
  const stickToBottom = forceScroll || shouldStickToBottom(elements.queueList);
  const orderedQueue = [...queuedItems].sort((left, right) => left.queuedAt - right.queuedAt);

  const markup = orderedQueue
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
        session?.isRunning && session?.provider === "codex"
          ? `<button class="queue-remove" type="button" data-queue-steer="${escapeHtml(item.runId)}">${escapeHtml(inlineText("Guide", "引导"))}</button>`
          : "",
        `<button class="queue-remove" type="button" data-queue-remove="${escapeHtml(item.runId)}">${escapeHtml(inlineText("Remove", "移除"))}</button>`,
      "</article>",
    ].join(""))
    .join("");
  if (renderSignatures.queue !== markup) {
    renderSignatures.queue = markup;
    elements.queueList.innerHTML = markup;
  }

  if (stickToBottom) {
    elements.queueList.scrollTop = elements.queueList.scrollHeight;
  }
  if (forceScroll) {
    state.forceDockScroll = null;
  }
}

function renderProjectList(): void {
  if (!elements.projectList) {
    return;
  }

  const searchQuery = state.projectSearchQuery.trim();
  const normalizedSearchQuery = searchQuery.toLowerCase();
  const hasSearchQuery = normalizedSearchQuery.length > 0;

  if (state.projects.length === 0 && state.workgroups.length === 0) {
    const markup = formatEmptyState(
      msg("terminal.empty.projectsTitle", "No projects yet"),
      msg("terminal.empty.projectsDetail", "Add a project in settings, then return here."),
    );
    if (renderSignatures.projectList !== markup) {
      renderSignatures.projectList = markup;
      elements.projectList.innerHTML = markup;
    }
    return;
  }

  if (state.sidebarMode === "messages") {
    const recentItems = [
      ...state.projects.map((project) => {
        const status = getProjectStatusMeta(project.id);
        const lastActivityAt = getProjectLastActivityAt(project.id);
        const latestPreview = getProjectLatestPreview(project.id);
        const searchHaystack = [
          project.name,
          project.path,
          project.groupName ?? "",
          project.agentId ?? "",
          latestPreview,
          status.label,
          status.detail,
          project.isRemote ? inlineText("Remote", "远程") : inlineText("Local", "本地"),
        ]
          .join(" ")
          .toLowerCase();
        return {
          key: `project:${project.id}`,
          type: "project" as const,
          id: project.id,
          name: project.name,
          selected: project.id === state.projectId,
          lastActivityAt,
          preview: latestPreview,
          meta: project.path,
          status,
          searchHaystack,
          badge: project.isRemote
            ? { className: "remote", label: inlineText("Remote", "远程") }
            : { className: "local", label: inlineText("Project", "项目") },
          extra: project.isRemote && project.agentId ? project.agentId : "",
        };
      }),
      ...state.workgroups.map((workgroup) => {
        const status = getWorkgroupStatusMeta(workgroup.id);
        const lastActivityAt = getWorkgroupLastActivityAt(workgroup.id);
        const latestPreview = getWorkgroupLatestPreview(workgroup.id);
        const searchHaystack = [
          workgroup.name,
          workgroup.description ?? "",
          workgroup.lastMessagePreview ?? "",
          latestPreview,
          status.label,
          status.detail,
          inlineText("Workgroup", "协作组"),
        ]
          .join(" ")
          .toLowerCase();
        return {
          key: `workgroup:${workgroup.id}`,
          type: "workgroup" as const,
          id: workgroup.id,
          name: workgroup.name,
          selected: workgroup.id === state.workgroupId,
          lastActivityAt,
          preview: latestPreview,
          meta: workgroup.description?.trim() || inlineText(`${workgroup.memberCount} members`, `${workgroup.memberCount} 名成员`),
          status,
          searchHaystack,
          badge: { className: "group", label: inlineText("Group", "群组") },
          extra: inlineText(`${workgroup.memberCount} members`, `${workgroup.memberCount} 名成员`),
        };
      }),
    ]
      .filter((item) => !hasSearchQuery || item.searchHaystack.includes(normalizedSearchQuery))
      .sort((left, right) => {
        const activityDiff = right.lastActivityAt - left.lastActivityAt;
        if (activityDiff !== 0) {
          return activityDiff;
        }
        return left.name.localeCompare(right.name, getLocale(), { sensitivity: "base" });
      });

    const emptyMarkup = formatEmptyState(
      hasSearchQuery
        ? inlineText("No matching conversations", "没有匹配的消息")
        : inlineText("No messages yet", "还没有消息"),
      hasSearchQuery
        ? inlineText("Try a different keyword.", "试试其他关键词。")
        : inlineText("Projects, remote agents, and workgroups will appear here after activity starts.", "本地项目、远程项目和协作组有消息后都会显示在这里。"),
    );
    const markup = recentItems.length === 0
      ? emptyMarkup
      : recentItems.map((item) => {
        const extraMeta = item.type === "project" && item.extra
          ? `<span class="project-meta-pill mono" title="${escapeHtml(item.extra)}">${escapeHtml(item.extra)}</span>`
          : (item.type === "workgroup"
            ? `<span class="project-meta-pill">${escapeHtml(item.extra)}</span>`
            : "");
        const buttonAttr = item.type === "project"
          ? `data-project-id="${escapeHtml(item.id)}"`
          : `data-workgroup-id="${escapeHtml(item.id)}"`;
        return [
          `<button class="project-list-item recent-chat-item${item.selected ? " selected" : ""}" type="button" ${buttonAttr}>`,
          '<div class="project-list-top">',
          `<div class="project-list-name-row"><span class="project-list-name">${highlightText(item.name, searchQuery)}</span><span class="project-origin-pill ${escapeHtml(item.badge.className)}">${escapeHtml(item.badge.label)}</span></div>`,
          `<span class="project-status-pill ${escapeHtml(item.status.tone)}">${escapeHtml(item.status.label)}</span>`,
          "</div>",
          `<div class="project-list-detail"><span class="project-list-summary">${highlightText(item.preview, searchQuery)}</span><span class="project-list-time">${escapeHtml(formatRelativeTime(item.lastActivityAt || 0))}</span></div>`,
          `<div class="project-list-meta"><span class="project-list-path" title="${escapeHtml(item.meta)}">${highlightText(previewText(item.meta, 84) || item.meta, searchQuery)}</span>${extraMeta}</div>`,
          "</button>",
        ].join("");
      }).join("");

    if (renderSignatures.projectList !== markup) {
      renderSignatures.projectList = markup;
      elements.projectList.innerHTML = markup;
    }
    return;
  }

  const renderProjectContactItem = (project: ProjectState): string => {
    const status = getProjectStatusMeta(project.id);
    const isSelected = project.id === state.projectId;
    const lastActivityAt = getActivity(project.id);
    const originBadge = project.isRemote
      ? `<span class="project-origin-pill remote">${escapeHtml(inlineText("Remote", "远程"))}</span>`
      : `<span class="project-origin-pill local">${escapeHtml(inlineText("Local", "本地"))}</span>`;
    const summaryText = previewText(status.detail, 78) || status.detail;
    const pathText = previewText(project.path, 84) || project.path;
    return [
      `<button class="project-list-item contact-list-item${isSelected ? " selected" : ""}" type="button" data-project-id="${escapeHtml(project.id)}">`,
      '<div class="project-list-top">',
      `<div class="project-list-name-row"><span class="project-list-name">${highlightText(project.name, searchQuery)}</span>${originBadge}</div>`,
      `<span class="project-status-pill ${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>`,
      "</div>",
      `<div class="project-list-detail" title="${escapeHtml(status.detail)}"><span class="project-list-summary">${highlightText(summaryText, searchQuery)}</span><span class="project-list-time">${escapeHtml(formatRelativeTime(lastActivityAt || 0))}</span></div>`,
      `<div class="project-list-meta"><span class="project-list-path" title="${escapeHtml(project.path)}">${highlightText(pathText, searchQuery)}</span>${project.isRemote && project.agentId ? `<span class="project-meta-pill mono" title="${escapeHtml(project.agentId)}">${escapeHtml(project.agentId)}</span>` : ""}</div>`,
      "</button>",
    ].join("");
  };

  const renderWorkgroupContactItem = (workgroup: WorkgroupSummary): string => {
    const status = getWorkgroupStatusMeta(workgroup.id);
    const isSelected = workgroup.id === state.workgroupId;
    const lastActivityAt = getWorkgroupActivity(workgroup.id);
    const subtitle = workgroup.lastMessagePreview?.trim() || inlineText(`${workgroup.memberCount} members`, `${workgroup.memberCount} 名成员`);
    const summaryText = previewText(status.detail, 78) || status.detail;
    return [
      `<button class="project-list-item contact-list-item${isSelected ? " selected" : ""}" type="button" data-workgroup-id="${escapeHtml(workgroup.id)}">`,
      '<div class="project-list-top">',
      `<div class="project-list-name-row"><span class="project-list-name">${highlightText(workgroup.name, searchQuery)}</span><span class="project-origin-pill group">${escapeHtml(inlineText("Group", "群组"))}</span></div>`,
      `<span class="project-status-pill ${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>`,
      "</div>",
      `<div class="project-list-detail" title="${escapeHtml(subtitle)}"><span class="project-list-summary">${highlightText(previewText(subtitle, 88) || subtitle, searchQuery)}</span><span class="project-list-time">${escapeHtml(formatRelativeTime(lastActivityAt || workgroup.updatedAt))}</span></div>`,
      `<div class="project-list-meta"><span class="project-list-path" title="${escapeHtml(status.detail)}">${highlightText(summaryText, searchQuery)}</span><span class="project-meta-pill">${escapeHtml(inlineText(`${workgroup.memberCount} members`, `${workgroup.memberCount} 名成员`))}</span></div>`,
      "</button>",
    ].join("");
  };

  const renderContactSection = (title: string, count: number, content: string, kind: "workgroups" | "remote" | "local"): string => [
    `<section class="contact-section" data-contact-section="${escapeHtml(kind)}">`,
    '<div class="contact-section-header">',
    `<span class="contact-section-title">${escapeHtml(title)}</span>`,
    `<span class="contact-section-count">${count}</span>`,
    "</div>",
    `<div class="contact-section-body">${content}</div>`,
    "</section>",
  ].join("");

  const groups = new Map<string, { label: string; projects: ProjectState[] }>();
  for (const project of state.projects.filter((entry) => !entry.isRemote)) {
    const groupKey = getProjectGroupKey(project);
    const groupLabel = getProjectGroupLabel(project);
    const entry = groups.get(groupKey) ?? { label: groupLabel, projects: [] };
    entry.label = groupLabel;
    entry.projects.push(project);
    groups.set(groupKey, entry);
  }

  const groupKeys = getOrderedGroupKeys(Array.from(groups.keys()));
  if (groupKeys.length !== state.groupOrder.length || groupKeys.some((key, index) => state.groupOrder[index] !== key)) {
    state.groupOrder = groupKeys;
    persistGroupOrder();
  }

  const activeCollapsed = new Set(Array.from(state.collapsedGroups).filter((key) => groups.has(key)));
  if (activeCollapsed.size !== state.collapsedGroups.size) {
    state.collapsedGroups = activeCollapsed;
    persistCollapsedGroups();
  }

  const activityCache = new Map<string, number>();
  const getActivity = (projectId: string): number => {
    if (activityCache.has(projectId)) {
      return activityCache.get(projectId) ?? 0;
    }
    const value = getProjectLastActivityAt(projectId);
    activityCache.set(projectId, value);
    return value;
  };

  const workgroupActivityCache = new Map<string, number>();
  const getWorkgroupActivity = (workgroupId: string): number => {
    if (workgroupActivityCache.has(workgroupId)) {
      return workgroupActivityCache.get(workgroupId) ?? 0;
    }
    const value = getWorkgroupLastActivityAt(workgroupId);
    workgroupActivityCache.set(workgroupId, value);
    return value;
  };

  const filteredWorkgroups = [...state.workgroups]
    .sort((left, right) => {
      const activityDiff = getWorkgroupActivity(right.id) - getWorkgroupActivity(left.id);
      if (activityDiff !== 0) {
        return activityDiff;
      }
      return left.name.localeCompare(right.name, getLocale(), { sensitivity: "base" });
    })
    .filter((workgroup) => {
      if (!hasSearchQuery) {
        return true;
      }
      const status = getWorkgroupStatusMeta(workgroup.id);
      const haystack = [
        workgroup.name,
        workgroup.description ?? "",
        workgroup.lastMessagePreview ?? "",
        status.label,
        status.detail,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearchQuery);
    });

  const workgroupSection = filteredWorkgroups.length === 0
    ? ""
    : renderContactSection(
        inlineText("Collaborations", "协作组"),
        filteredWorkgroups.length,
        filteredWorkgroups.map((workgroup) => renderWorkgroupContactItem(workgroup)).join(""),
        "workgroups",
      );

  const remoteProjects = [...state.projects]
    .filter((project) => project.isRemote)
    .sort((left, right) => {
      const activityDiff = getActivity(right.id) - getActivity(left.id);
      if (activityDiff !== 0) {
        return activityDiff;
      }
      return left.name.localeCompare(right.name, getLocale(), { sensitivity: "base" });
    })
    .filter((project) => {
      if (!hasSearchQuery) {
        return true;
      }
      const status = getProjectStatusMeta(project.id);
      const haystack = [
        project.name,
        project.path,
        project.agentId ?? "",
        status.label,
        status.detail,
        inlineText("Remote", "远程"),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearchQuery);
    });

  const remoteSection = remoteProjects.length === 0
    ? ""
    : renderContactSection(
        inlineText("Remote Agents", "远程"),
        remoteProjects.length,
        remoteProjects.map((project) => renderProjectContactItem(project)).join(""),
        "remote",
      );

  const projectSections = groupKeys
    .map((groupKey) => {
      const group = groups.get(groupKey);
      if (!group) {
        return "";
      }
      const isCollapsed = state.collapsedGroups.has(groupKey);
      const projects = [...group.projects].sort((left, right) => {
        const activityDiff = getActivity(right.id) - getActivity(left.id);
        if (activityDiff !== 0) {
          return activityDiff;
        }
        return left.name.localeCompare(right.name, getLocale(), { sensitivity: "base" });
      })
        .filter((project) => {
          if (!hasSearchQuery) {
            return true;
          }
          const status = getProjectStatusMeta(project.id);
          const haystack = [
            project.name,
            project.path,
            project.agentId ?? "",
            status.label,
            status.detail,
            project.isRemote ? inlineText("Remote", "远程") : inlineText("Local", "本地"),
            project.groupName ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(normalizedSearchQuery);
        });
      if (projects.length === 0) {
        return "";
      }
      return [
        `<section class="project-group${isCollapsed ? " collapsed" : ""}" data-group-key="${escapeHtml(groupKey)}">`,
        `<div class="project-group-header" role="button" tabindex="0" draggable="true" data-group-header="${escapeHtml(groupKey)}" data-group-key="${escapeHtml(groupKey)}" aria-expanded="${isCollapsed ? "false" : "true"}">`,
        '<span class="project-group-toggle" aria-hidden="true"></span>',
        `<span class="project-group-title">${escapeHtml(group.label)}</span>`,
        `<span class="project-group-count">${projects.length}</span>`,
        "</div>",
        ...projects.map((project) => renderProjectContactItem(project)),
        "</section>",
      ].join("");
    })
    .join("");

  const localProjectCount = groupKeys.reduce((total, groupKey) => {
    const group = groups.get(groupKey);
    return total + (group ? group.projects.filter((project) => {
      if (!hasSearchQuery) {
        return true;
      }
      const status = getProjectStatusMeta(project.id);
      const haystack = [
        project.name,
        project.path,
        project.agentId ?? "",
        status.label,
        status.detail,
        inlineText("Local", "本地"),
        project.groupName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearchQuery);
    }).length : 0);
  }, 0);

  const localSection = projectSections
    ? renderContactSection(
        inlineText("Projects", "本地项目"),
        localProjectCount,
        projectSections,
        "local",
      )
    : "";

  const emptyMarkup = formatEmptyState(
    hasSearchQuery
      ? inlineText("No matching contacts", "没有匹配的通讯录")
      : inlineText("No contacts yet", "通讯录还是空的"),
    hasSearchQuery
      ? inlineText("Try a different keyword.", "试试其他关键词。")
      : inlineText("Projects, remote agents, and workgroups will appear here together.", "本地项目、远程项目和协作组都会统一显示在这里。"),
  );
  const markup = `${workgroupSection}${remoteSection}${localSection}` || emptyMarkup;
  if (renderSignatures.projectList !== markup) {
    renderSignatures.projectList = markup;
    elements.projectList.innerHTML = markup;
  }
}

function scheduleProjectListRender(delayMs = 180): void {
  if (projectListRenderTimer !== null) {
    window.clearTimeout(projectListRenderTimer);
  }
  projectListRenderTimer = window.setTimeout(() => {
    projectListRenderTimer = null;
    render({
      staticI18n: false,
      projectList: true,
      header: false,
      workbench: false,
      panel: false,
      attachments: false,
      lightbox: false,
      hint: false,
    });
  }, delayMs);
}

function scheduleWorkspaceRender(delayMs = WORKSPACE_RENDER_DEBOUNCE_MS): void {
  if (workspaceRenderTimer !== null) {
    window.clearTimeout(workspaceRenderTimer);
  }
  workspaceRenderTimer = window.setTimeout(() => {
    workspaceRenderTimer = null;
    renderWorkspaceOnly();
  }, delayMs);
}

function scheduleProjectSearchRender(delayMs = 80): void {
  if (projectSearchTimer !== null) {
    window.clearTimeout(projectSearchTimer);
  }
  projectSearchTimer = window.setTimeout(() => {
    projectSearchTimer = null;
    renderProjectList();
  }, delayMs);
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
    clearHistoryAutoloadTimer("cli");
    const markup = formatEmptyState(
      inlineText("No project selected", "未选择项目"),
      inlineText("Select a project to inspect the live CLI execution stream.", "选择一个项目查看实时 CLI 执行流。"),
    );
    if (renderSignatures.cli !== markup) {
      renderSignatures.cli = markup;
      elements.cliTrace.innerHTML = markup;
    }
    return;
  }

  const historyState = state.projectId ? getProjectHistoryState(state.projectId) : null;
  const entries = getDisplayedCliTrace();
  if (entries.length === 0) {
    const markup = renderDockBlank();
    clearHistoryAutoloadTimer("cli");
    if (renderSignatures.cli !== markup) {
      renderSignatures.cli = markup;
      elements.cliTrace.innerHTML = markup;
    }
    return;
  }

  const forceScroll = state.forceDockScroll === "cli";
  const stickToBottom = forceScroll || shouldStickToBottom(elements.cliTrace);

  const markup = [
    historyState?.hasMoreCli ? `<div class="history-loader">${escapeHtml(inlineText("Scroll up to load earlier CLI output", "向上滚动加载更早的 CLI 输出"))}</div>` : "",
    ...entries.map((entry) => [
      `<article class="cli-line ${escapeHtml(entry.stream)}">`,
      '<div class="cli-line-meta">',
      `<span class="cli-stream-badge ${escapeHtml(entry.stream)}">${escapeHtml(translateCliStream(entry.stream))}</span>`,
      `<span class="activity-time">${escapeHtml(formatTime(entry.createdAt))}</span>`,
      "</div>",
      `<div class="cli-line-text">${escapeHtml(entry.text)}</div>`,
      "</article>",
    ].join("")),
  ].join("");
  if (renderSignatures.cli !== markup) {
    renderSignatures.cli = markup;
    elements.cliTrace.innerHTML = markup;
  }

  if (stickToBottom) {
    elements.cliTrace.scrollTop = elements.cliTrace.scrollHeight;
  }
  if (historyState?.hasMoreCli) {
    scheduleHistoryAutoload("cli");
  } else {
    clearHistoryAutoloadTimer("cli");
  }
  if (forceScroll) {
    state.forceDockScroll = null;
  }
}

function renderMessages(): void {
  if (!elements.messages) {
    return;
  }

  const forceScroll = state.forceDockScroll === "messages";
  const messagesViewportKey = getCurrentMessagesViewportKey();
  const firstRenderForViewport = Boolean(messagesViewportKey) && state.lastRenderedMessagesViewportKey !== messagesViewportKey;
  const workgroup = getCurrentWorkgroup();
  const workgroupSession = getCurrentWorkgroupSession();
  if (workgroup) {
    const historyState = state.workgroupId ? getWorkgroupHistoryState(state.workgroupId) : null;
    const messages = getVisibleWorkgroupMessages();
    if (!workgroupSession || messages.length === 0) {
      clearHistoryAutoloadTimer("messages");
      updateMessagesJumpButtonVisibility();
      const markup = formatEmptyState(
        state.messageSearchQuery.trim()
          ? inlineText("No matching messages", "没有匹配的消息")
          : inlineText("No collaboration yet", "还没有协作消息"),
        state.messageSearchQuery.trim()
          ? inlineText("Try a different keyword.", "试试其他关键词。")
          : inlineText("Send a message to coordinate the group.", "发送一条消息开始协作。"),
      );
      if (renderSignatures.messages !== markup) {
        renderSignatures.messages = markup;
        elements.messages.innerHTML = markup;
      }
      return;
    }

    const stickToBottom = forceScroll
      || firstRenderForViewport
      || elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < 80;

    const markup = [
      state.messageSearchQuery.trim()
        ? `<div class="message-search-empty">${escapeHtml(inlineText(`${messages.length} matches`, `${messages.length} 条结果`))}<span>${escapeHtml(state.messageSearchLoading ? inlineText("Searching...", "搜索中...") : inlineText("Search in current collaboration", "当前协作组内搜索"))}</span></div>`
        : (historyState?.hasMoreMessages ? `<div class="history-loader">${escapeHtml(inlineText("Scroll up to load earlier messages", "向上滚动加载更早的消息"))}</div>` : ""),
      ...messages.map((message) => {
        const cardRole = message.senderType === "member"
          ? "assistant"
          : (message.senderType === "user" ? "user" : "error");
        const senderBadge = message.senderType === "member" && message.memberRole === "project_manager"
          ? `${message.senderName} · ${translateWorkgroupRole(message.memberRole)}`
          : message.senderName;
        const sourceBadge = message.senderType === "member"
          ? (message.projectKind === "remote" ? inlineText("Remote", "远程") : inlineText("Local", "本地"))
          : (message.senderType === "user" ? inlineText("You", "你") : inlineText("System", "系统"));
        const content = message.content.trim() || (message.status === "streaming"
          ? inlineText("Responding...", "正在回复...")
          : inlineText("No content", "暂无内容"));
        const actionButton = message.content.trim()
          ? `<button class="message-action-button" type="button" data-copy-message-id="${escapeHtml(message.id)}">${escapeHtml(inlineText("Copy", "复制"))}</button>`
          : "";

        return [
          `<article class="message-card ${escapeHtml(cardRole)}">`,
          '<div class="message-shell">',
          '<div class="message-meta">',
          `<span class="role-badge ${escapeHtml(cardRole)}">${escapeHtml(senderBadge)}</span>`,
          `<span class="source-badge">${escapeHtml(sourceBadge)}</span>`,
          `<span class="message-time" title="${escapeHtml(formatDateTime(message.updatedAt || message.createdAt))}">${escapeHtml(formatTime(message.updatedAt || message.createdAt))}</span>`,
          actionButton,
          "</div>",
          `<div class="message-content markdown-content${message.status === "streaming" ? " streaming" : ""}">${renderMarkdownContent(content, state.messageSearchQuery)}</div>`,
          "</div>",
          "</article>",
        ].join("");
      }),
    ].join("");
    if (renderSignatures.messages !== markup) {
      renderSignatures.messages = markup;
      elements.messages.innerHTML = markup;
    }

    if (stickToBottom) {
      scheduleMessagesScrollToBottom();
    } else {
      updateMessagesJumpButtonVisibility();
    }
    state.lastRenderedMessagesViewportKey = messagesViewportKey;
    if (forceScroll) {
      state.forceDockScroll = null;
    }
    if (!state.messageSearchQuery.trim() && historyState?.hasMoreMessages) {
      scheduleHistoryAutoload("messages");
    } else {
      clearHistoryAutoloadTimer("messages");
    }
    return;
  }

  const project = getCurrentProject();
  const session = getCurrentSession();

  if (!project) {
    clearHistoryAutoloadTimer("messages");
    updateMessagesJumpButtonVisibility();
    const markup = formatEmptyState(
      msg("terminal.empty.selectProjectTitle", "No project selected"),
      msg("terminal.empty.selectProjectDetail", "Choose a project from the left sidebar to view messages."),
    );
    if (renderSignatures.messages !== markup) {
      renderSignatures.messages = markup;
      elements.messages.innerHTML = markup;
    }
    return;
  }

  const historyState = state.projectId ? getProjectHistoryState(state.projectId) : null;
  const messages = getVisibleProjectMessages();
  if (!session || messages.length === 0) {
    clearHistoryAutoloadTimer("messages");
    updateMessagesJumpButtonVisibility();
    const markup = formatEmptyState(
      state.messageSearchQuery.trim()
        ? inlineText("No matching messages", "没有匹配的消息")
        : msg("terminal.empty.messagesTitle", "No conversation yet"),
      state.messageSearchQuery.trim()
        ? inlineText("Try a different keyword.", "试试其他关键词。")
        : msg(
          "terminal.empty.messagesDetail",
          "Incoming remote prompts and local desktop prompts will appear here as clean message cards.",
        ),
    );
    if (renderSignatures.messages !== markup) {
      renderSignatures.messages = markup;
      elements.messages.innerHTML = markup;
    }
    return;
  }

  const stickToBottom = forceScroll
    || firstRenderForViewport
    || elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < 80;

  const markup = [
    state.messageSearchQuery.trim()
      ? `<div class="message-search-empty">${escapeHtml(inlineText(`${messages.length} matches`, `${messages.length} 条结果`))}<span>${escapeHtml(state.messageSearchLoading ? inlineText("Searching...", "搜索中...") : inlineText("Search in current conversation", "当前会话内搜索"))}</span></div>`
      : (historyState?.hasMoreMessages ? `<div class="history-loader">${escapeHtml(inlineText("Scroll up to load earlier messages", "向上滚动加载更早的消息"))}</div>` : ""),
    ...messages.map((message) => {
      const sourceBadge = message.role === "user"
        ? translateSource(message.source)
        : providerLabel(message.provider ?? session.provider);
      const actionButton = message.content.trim()
        ? `<button class="message-action-button" type="button" data-copy-message-id="${escapeHtml(message.id)}">${escapeHtml(inlineText("Copy", "复制"))}</button>`
        : "";

      return [
        `<article class="message-card ${escapeHtml(message.role)}">`,
        '<div class="message-shell">',
        '<div class="message-meta">',
        `<span class="role-badge ${escapeHtml(message.role)}">${escapeHtml(translateRole(message.role))}</span>`,
        `<span class="source-badge">${escapeHtml(sourceBadge)}</span>`,
        `<span class="message-time" title="${escapeHtml(formatDateTime(message.updatedAt || message.createdAt))}">${escapeHtml(formatTime(message.updatedAt || message.createdAt))}</span>`,
        actionButton,
        "</div>",
        message.attachments && message.attachments.length > 0
          ? `<div class="message-attachments">${message.attachments.map((attachment) => renderAttachmentCardView(attachment)).join("")}</div>`
          : "",
        message.content
          ? `<div class="message-content markdown-content${message.status === "streaming" ? " streaming" : ""}">${renderMarkdownContent(message.content, state.messageSearchQuery)}</div>`
          : "",
        "</div>",
        "</article>",
      ].join("");
    }),
  ].join("");
  if (renderSignatures.messages !== markup) {
    renderSignatures.messages = markup;
    elements.messages.innerHTML = markup;
  }

  if (stickToBottom) {
    scheduleMessagesScrollToBottom();
  } else {
    updateMessagesJumpButtonVisibility();
  }
  state.lastRenderedMessagesViewportKey = messagesViewportKey;
  if (forceScroll) {
    state.forceDockScroll = null;
  }
  if (!state.messageSearchQuery.trim() && historyState?.hasMoreMessages) {
    scheduleHistoryAutoload("messages");
  } else {
    clearHistoryAutoloadTimer("messages");
  }
}

function renderActivities(): void {
  if (!elements.activityList) {
    return;
  }

  const session = getCurrentSession();

  if (!state.projectId) {
    clearHistoryAutoloadTimer("activities");
    updateActivityJumpButtonVisibility();
    const markup = formatEmptyState(
      msg("terminal.empty.selectProjectTitle", "No project selected"),
      msg("terminal.empty.selectProjectDetail", "Choose a project from the left sidebar to view messages."),
    );
    if (renderSignatures.activities !== markup) {
      renderSignatures.activities = markup;
      elements.activityList.innerHTML = markup;
    }
    return;
  }

  const historyState = state.projectId ? getProjectHistoryState(state.projectId) : null;
  const activities = getDisplayedActivities();
  if (!session || activities.length === 0) {
    const markup = renderDockBlank();
    clearHistoryAutoloadTimer("activities");
    updateActivityJumpButtonVisibility();
    if (renderSignatures.activities !== markup) {
      renderSignatures.activities = markup;
      elements.activityList.innerHTML = markup;
    }
    return;
  }

  const forceScroll = state.forceDockScroll === "activity";
  const activityViewportKey = getCurrentActivityViewportKey();
  const firstRenderForViewport = Boolean(activityViewportKey) && state.lastRenderedActivityViewportKey !== activityViewportKey;
  const stickToBottom = forceScroll || firstRenderForViewport || shouldStickToBottom(elements.activityList);

  const markup = [
    historyState?.hasMoreActivities ? `<div class="history-loader">${escapeHtml(inlineText("Scroll up to load earlier activity", "向上滚动加载更早的活动"))}</div>` : "",
    ...activities
    .map((activity) => [
      '<article class="activity-card">',
      '<div class="activity-shell">',
      '<div class="activity-meta">',
      `<span class="kind-badge ${escapeHtml(activity.kind)}">${escapeHtml(translateKind(activity.kind))}</span>`,
      `<span class="status-badge ${escapeHtml(activity.status)}">${escapeHtml(translateActivityStatus(activity.status))}</span>`,
      `<span class="activity-time" title="${escapeHtml(formatDateTime(activity.createdAt || activity.updatedAt))}">${escapeHtml(formatTime(activity.createdAt || activity.updatedAt))}</span>`,
      `<button class="message-action-button" type="button" data-copy-activity-id="${escapeHtml(activity.id)}">${escapeHtml(inlineText("Copy", "复制"))}</button>`,
      "</div>",
      `<div class="activity-title">${escapeHtml(activity.title || msg("terminal.activity.fallbackTitle", "Activity"))}</div>`,
      `<div class="activity-detail">${escapeHtml(activity.detail)}</div>`,
      "</div>",
      "</article>",
    ].join("")),
  ].join("");
  if (renderSignatures.activities !== markup) {
    renderSignatures.activities = markup;
    elements.activityList.innerHTML = markup;
  }

  if (stickToBottom) {
    scheduleActivitiesScrollToBottom();
  } else {
    updateActivityJumpButtonVisibility();
  }
  state.lastRenderedActivityViewportKey = activityViewportKey;
  if (historyState?.hasMoreActivities) {
    scheduleHistoryAutoload("activities");
  } else {
    clearHistoryAutoloadTimer("activities");
  }
  if (forceScroll) {
    state.forceDockScroll = null;
  }
}

function renderHeader(): void {
  const workgroup = getCurrentWorkgroup();
  const project = workgroup ? null : getCurrentProject();
  const session = workgroup ? null : getCurrentSession();
  const provider = workgroup ? "claude" : getConfiguredProvider(project, session);
  const model = workgroup ? null : getConfiguredModel(project, session);
  const statusMeta = workgroup
    ? getWorkgroupStatusMeta(workgroup.id)
    : (project ? getProjectStatusMeta(project.id) : null);
  const headerSignature = JSON.stringify({
    lang: state.lang,
    workgroup: workgroup ? {
      id: workgroup.id,
      name: workgroup.name,
      description: workgroup.description ?? "",
      memberCount: workgroup.memberCount,
      statusLabel: statusMeta?.label ?? "",
      statusTone: statusMeta?.tone ?? "",
      statusDetail: statusMeta?.detail ?? "",
    } : null,
    project: !workgroup ? {
      id: project?.id ?? "",
      name: project?.name ?? "",
      path: project?.path ?? "",
      provider,
      model: model ?? "",
      statusLabel: statusMeta?.label ?? "",
      statusTone: statusMeta?.tone ?? "",
      statusDetail: statusMeta?.detail ?? "",
      isRunning: Boolean(session?.isRunning),
      queuedCount: session?.queuedCount ?? 0,
      conversationCount: session?.conversations.length ?? 0,
      activeConversationId: session?.activeConversationId ?? "",
    } : null,
  });
  if (renderSignatures.header === headerSignature) {
    syncDocumentTitleIfNeeded();
    return;
  }
  renderSignatures.header = headerSignature;
  if (workgroup) {
    const workgroupStatusMeta = statusMeta ?? getWorkgroupStatusMeta(workgroup.id);
    document.body.dataset.provider = "claude";
    if (elements.projectTitle) {
      elements.projectTitle.textContent = workgroup.name;
    }
    if (elements.projectMeta) {
      elements.projectMeta.textContent = workgroup.description?.trim()
        || inlineText(`${workgroup.memberCount} members`, `${workgroup.memberCount} 名成员`);
    }
    if (elements.providerBadge) {
      elements.providerBadge.textContent = inlineText("Collab", "协作");
    }
    if (elements.modelBadge) {
      elements.modelBadge.textContent = inlineText("Group", "群组");
      elements.modelBadge.title = inlineText("Shared collaboration", "共享协作");
      elements.modelBadge.disabled = true;
      elements.modelBadge.hidden = false;
    }
    if (elements.modeBadge) {
      elements.modeBadge.textContent = inlineText("Shared", "共享");
    }
    if (elements.sessionViewTitle) {
      elements.sessionViewTitle.textContent = workgroup.name;
    }
    if (elements.conversationSelect) {
      if (lastConversationSelectSignature !== "workgroup:hidden") {
        elements.conversationSelect.innerHTML = "";
        lastConversationSelectSignature = "workgroup:hidden";
      }
      elements.conversationSelect.disabled = true;
      elements.conversationSelect.parentElement?.setAttribute("hidden", "true");
    }
    if (elements.newConversationBtn) {
      elements.newConversationBtn.disabled = true;
      elements.newConversationBtn.hidden = true;
    }
    if (elements.headerSummary) {
      elements.headerSummary.textContent = workgroupStatusMeta.detail;
    }
    if (elements.runState) {
      elements.runState.textContent = workgroupStatusMeta.label;
      elements.runState.className = `project-status-pill ${workgroupStatusMeta.tone}`;
    }
    if (elements.sendBtn) {
      elements.sendBtn.disabled = false;
    }
    if (elements.stopBtn) {
      elements.stopBtn.disabled = true;
    }
    syncAttachmentButtons();
    if (elements.activityTab) {
      elements.activityTab.disabled = true;
    }
    if (elements.cliTab) {
      elements.cliTab.disabled = true;
    }
    if (elements.queueTab) {
      elements.queueTab.disabled = true;
    }
    if (elements.composerLabel) {
      elements.composerLabel.textContent = inlineText("Message", "消息");
    }
    if (elements.composerInput) {
      elements.composerInput.placeholder = inlineText(
        "Talk to the group and @member names when needed.",
        "直接在群里协作，必要时用 @成员名 提及。",
      );
    }
    if (elements.composerModelBtn) {
      elements.composerModelBtn.textContent = inlineText("Shared group", "协作组");
      elements.composerModelBtn.title = inlineText("Group collaboration does not use per-project model switching", "协作组不使用项目级模型切换");
      elements.composerModelBtn.disabled = true;
      elements.composerModelBtn.hidden = false;
    }
    syncComposerRunModeSelect(false, inlineText("Run modes are disabled in collaboration groups", "协作组不使用项目运行模式"));
    syncComposerReasoningSelect(false, inlineText("Reasoning effort is disabled in collaboration groups", "协作组不使用推理强度"));
    syncDocumentTitleIfNeeded();
    return;
  }

  elements.conversationSelect?.parentElement?.removeAttribute("hidden");
  if (elements.newConversationBtn) {
    elements.newConversationBtn.hidden = false;
  }
  if (elements.composerLabel) {
    elements.composerLabel.textContent = inlineText("Prompt", "提示词");
  }
  if (elements.composerInput) {
    elements.composerInput.placeholder = inlineText(
      "Ask Claude Code or OpenAI Codex to inspect, edit, review, or debug this project.",
      "让 Claude Code 或 OpenAI Codex 检查、修改、评审或调试这个项目。",
    );
  }

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
  if (elements.composerModelBtn) {
    elements.composerModelBtn.textContent = `${inlineText("Model", "模型")}: ${modelLabel(model)}`;
    elements.composerModelBtn.title = inlineText(
      "Switch the model for this project. Same-model sessions are reused; new models receive capped recent context.",
      "切换当前项目模型。同模型会复用会话；新模型会带上截断后的近期上下文。",
    );
    elements.composerModelBtn.disabled = !project;
    elements.composerModelBtn.hidden = false;
  }
  syncComposerRunModeSelect(
    Boolean(project && provider === "codex"),
    provider === "codex"
      ? inlineText("Select a project before choosing a run mode", "先选择项目，再选择运行模式")
      : inlineText("Plan and goal modes are available for Codex projects", "计划和目标模式仅在 Codex 项目中可用"),
  );
  syncComposerReasoningSelect(
    Boolean(project && provider === "codex"),
    provider === "codex"
      ? inlineText("Select a project before choosing reasoning effort", "先选择项目，再选择推理强度")
      : inlineText("Reasoning effort is available for Codex projects", "推理强度仅在 Codex 项目中可用"),
  );
  if (elements.modeBadge) {
    elements.modeBadge.textContent = msg("terminal.mode.fullAuto", "Full auto");
  }
  if (elements.sessionViewTitle) {
    elements.sessionViewTitle.textContent = project?.name ?? msg("terminal.projectFallback", "Project");
  }
  if (elements.conversationSelect) {
    const conversations = session?.conversations ?? [];
    const conversationSelectDisabled =
      !project || conversations.length === 0 || Boolean(session?.isRunning) || (session?.queuedCount ?? 0) > 0;
    const conversationSignature = JSON.stringify({
      disabled: conversationSelectDisabled,
      items: conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        isActive: conversation.isActive,
      })),
    });
    if (lastConversationSelectSignature !== conversationSignature) {
      elements.conversationSelect.innerHTML = conversations
        .map((conversation) => `<option value="${escapeHtml(conversation.id)}"${conversation.isActive ? " selected" : ""}>${escapeHtml(conversation.title)}</option>`)
        .join("");
      lastConversationSelectSignature = conversationSignature;
    }
    elements.conversationSelect.disabled = conversationSelectDisabled;
  }
  if (elements.newConversationBtn) {
    elements.newConversationBtn.disabled = !project || Boolean(session?.isRunning) || (session?.queuedCount ?? 0) > 0 || !api.createProjectConversation;
    elements.newConversationBtn.textContent = inlineText("New", "新建");
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
  syncAttachmentButtons();
  if (elements.activityTab) {
    elements.activityTab.disabled = !state.projectId;
  }
  if (elements.cliTab) {
    elements.cliTab.disabled = !state.projectId;
  }
  if (elements.queueTab) {
    elements.queueTab.disabled = !state.projectId;
  }

  syncDocumentTitleIfNeeded();
}

function render(options: RenderOptions = {}): void {
  const {
    staticI18n = true,
    projectList = true,
    header = true,
    workbench = true,
    panel = true,
    attachments = true,
    lightbox = true,
    hint = true,
  } = options;

  if (staticI18n) {
    applyStaticI18n();
  }
  if (elements.projectSearchInput && elements.projectSearchInput.value !== state.projectSearchQuery) {
    elements.projectSearchInput.value = state.projectSearchQuery;
  }
  if (elements.messageSearchInput && elements.messageSearchInput.value !== state.messageSearchQuery) {
    elements.messageSearchInput.value = state.messageSearchQuery;
  }
  renderSidebarModeControls();
  if (projectList) {
    renderProjectList();
  }
  if (header) {
    renderHeader();
  }
  if (workbench) {
    renderWorkbench();
  }
  if (panel) {
    const showDock = Boolean(state.projectId) && !isWorkgroupSelected() && state.activeView !== "messages";
    if (!showDock) {
      renderMessages();
    } else if (state.activeView === "activity") {
      renderActivities();
    } else if (state.activeView === "cli") {
      renderCliTrace();
    } else if (state.activeView === "queue") {
      renderQueue();
    } else {
      renderMessages();
    }
  }
  if (attachments) {
    renderPendingAttachments();
  }
  if (lightbox) {
    renderAttachmentLightbox();
  }
  if (hint) {
    renderHint();
  }
}

function renderPanelOnly(): void {
  render({
    staticI18n: false,
    projectList: false,
    header: false,
    workbench: false,
    panel: true,
    attachments: false,
    lightbox: false,
    hint: false,
  });
}

function renderWorkspaceOnly(): void {
  render({
    staticI18n: false,
    projectList: false,
    header: true,
    workbench: true,
    panel: true,
    attachments: false,
    lightbox: false,
    hint: false,
  });
}

async function loadProjectSession(
  projectId: string,
  options: { forceRemoteSync?: boolean } = {},
): Promise<void> {
  if (state.sessionsByProjectId.has(projectId)) {
    return;
  }
  const existingLoad = projectSessionLoads.get(projectId);
  if (existingLoad) {
    await existingLoad;
    return;
  }
  const loadPromise = (async () => {
    const result = await api.getProjectSession({
      projectId,
      forceRemoteSync: options.forceRemoteSync === true,
    });
    if (!result.success || !result.session) {
      return;
    }

    state.sessionsByProjectId.set(projectId, result.session);
    syncHistoryStateFromSnapshot(result.session);
  })();
  projectSessionLoads.set(projectId, loadPromise);
  try {
    await loadPromise;
  } finally {
    if (projectSessionLoads.get(projectId) === loadPromise) {
      projectSessionLoads.delete(projectId);
    }
  }
}

async function ensureActiveProjectSessionLoaded(forceRemoteSync = false): Promise<boolean> {
  const projectId = state.projectId?.trim() ?? "";
  if (!projectId || !state.projects.some((project) => project.id === projectId) || state.sessionsByProjectId.has(projectId)) {
    return false;
  }
  await loadProjectSession(projectId, { forceRemoteSync });
  return true;
}

async function loadWorkgroupSession(workgroupId: string): Promise<void> {
  const getWorkgroupCollaborationSession = api.getWorkgroupCollaborationSession;
  if (!getWorkgroupCollaborationSession) {
    return;
  }
  if (state.sessionsByWorkgroupId.has(workgroupId)) {
    return;
  }
  const existingLoad = workgroupSessionLoads.get(workgroupId);
  if (existingLoad) {
    await existingLoad;
    return;
  }
  const loadPromise = (async () => {
    const result = await getWorkgroupCollaborationSession(workgroupId);
    if (!result.success || !result.session) {
      return;
    }

    state.sessionsByWorkgroupId.set(workgroupId, result.session);
    syncWorkgroupHistoryStateFromSnapshot(result.session);
  })();
  workgroupSessionLoads.set(workgroupId, loadPromise);
  try {
    await loadPromise;
  } finally {
    if (workgroupSessionLoads.get(workgroupId) === loadPromise) {
      workgroupSessionLoads.delete(workgroupId);
    }
  }
}

async function syncProjects(projects?: ProjectState[]): Promise<void> {
  const nextProjects = projects ?? await api.getProjects({ refreshRemote: true });
  const nextSignature = buildProjectCatalogSignature(nextProjects);
  const hadSameCatalog = nextSignature === lastProjectCatalogSignature;
  const projectIds = new Set(nextProjects.map((project) => project.id));
  const hadRemovedProjects = Array.from(state.sessionsByProjectId.keys()).some((projectId) => !projectIds.has(projectId));
  const previousProjectId = state.projectId;
  const previousWorkgroupId = state.workgroupId;

  state.projects = nextProjects;
  lastProjectCatalogSignature = nextSignature;

  for (const projectId of Array.from(state.sessionsByProjectId.keys())) {
    if (!projectIds.has(projectId)) {
      state.sessionsByProjectId.delete(projectId);
      state.historyByProjectId.delete(projectId);
      lastProjectSnapshotSignatureByProjectId.delete(projectId);
      projectSessionLoads.delete(projectId);
    }
  }

  if (state.projectId && !projectIds.has(state.projectId)) {
    if (state.workgroupId) {
      setActiveProject(null);
    } else {
      const preferred = getPreferredSidebarSelection();
      if (preferred?.workgroupId) {
        setActiveWorkgroup(preferred.workgroupId);
      } else {
        setActiveProject(preferred?.projectId ?? null);
      }
    }
  }

  if (!state.projectId && !state.workgroupId && nextProjects.length > 0) {
    const preferred = getPreferredSidebarSelection();
    if (preferred?.workgroupId) {
      setActiveWorkgroup(preferred.workgroupId);
    } else if (preferred?.projectId) {
      setActiveProject(preferred.projectId);
    }
  }

  const hydratedActiveProject = await ensureActiveProjectSessionLoaded(true);
  syncActiveViewForCurrentProject();
  if (state.messageSearchQuery.trim()) {
    scheduleMessageSearch();
  }
  const selectionChanged = previousProjectId !== state.projectId || previousWorkgroupId !== state.workgroupId;
  if (hadSameCatalog && !hadRemovedProjects && !selectionChanged && !hydratedActiveProject) {
    return;
  }
  render();
}

async function syncWorkgroups(workgroups?: WorkgroupSummary[]): Promise<void> {
  const nextWorkgroups = workgroups ?? (await api.listWorkgroupCollaborations?.())?.workgroups ?? [];
  const nextSignature = buildWorkgroupSummarySignature(nextWorkgroups);
  const hadSameSummary = nextSignature === lastWorkgroupSummarySignature;
  const workgroupIds = new Set(nextWorkgroups.map((workgroup) => workgroup.id));
  const missingSessions = nextWorkgroups
    .filter((workgroup) => !state.sessionsByWorkgroupId.has(workgroup.id));
  const hadRemovedWorkgroups = Array.from(state.sessionsByWorkgroupId.keys()).some((workgroupId) => !workgroupIds.has(workgroupId));
  const previousProjectId = state.projectId;
  const previousWorkgroupId = state.workgroupId;

  state.workgroups = nextWorkgroups;
  lastWorkgroupSummarySignature = nextSignature;

  for (const workgroupId of Array.from(state.sessionsByWorkgroupId.keys())) {
    if (!workgroupIds.has(workgroupId)) {
      state.sessionsByWorkgroupId.delete(workgroupId);
      state.historyByWorkgroupId.delete(workgroupId);
      lastWorkgroupSnapshotSignatureById.delete(workgroupId);
      workgroupSessionLoads.delete(workgroupId);
    }
  }

  await Promise.all(
    missingSessions.map((workgroup) => loadWorkgroupSession(workgroup.id)),
  );

  if (state.workgroupId && !workgroupIds.has(state.workgroupId)) {
    setActiveWorkgroup(null);
  }

  if (!state.projectId && !state.workgroupId && nextWorkgroups.length > 0 && state.projects.length === 0) {
    const preferred = getPreferredSidebarSelection();
    if (preferred?.workgroupId) {
      setActiveWorkgroup(preferred.workgroupId);
    } else if (preferred?.projectId) {
      setActiveProject(preferred.projectId);
    }
  }

  if (state.messageSearchQuery.trim()) {
    scheduleMessageSearch();
  }
  const selectionChanged = previousProjectId !== state.projectId || previousWorkgroupId !== state.workgroupId;
  if (hadSameSummary && !hadRemovedWorkgroups && missingSessions.length === 0 && !selectionChanged) {
    return;
  }
  render();
}

async function selectProject(projectId: string): Promise<void> {
  if (!state.projects.some((project) => project.id === projectId)) {
    return;
  }

  setActiveProject(projectId);
  if (!state.sessionsByProjectId.has(projectId)) {
    await loadProjectSession(projectId, { forceRemoteSync: true });
  }
  syncActiveViewForCurrentProject();
  if (state.messageSearchQuery.trim()) {
    scheduleMessageSearch();
  }
  render();
  focusComposerAtEnd();
}

async function applyProjectSelectionFromMain(projectId: string | null): Promise<void> {
  if (!projectId) {
    if (state.workgroupId) {
      return;
    }
    if (state.projectId === null) {
      return;
    }
    setActiveProject(null);
    syncActiveViewForCurrentProject();
    if (state.messageSearchQuery.trim()) {
      scheduleMessageSearch();
    }
    render();
    return;
  }

  await selectProject(projectId);
}

async function selectWorkgroup(workgroupId: string): Promise<void> {
  if (!state.workgroups.some((workgroup) => workgroup.id === workgroupId)) {
    return;
  }

  setActiveWorkgroup(workgroupId);
  if (!state.sessionsByWorkgroupId.has(workgroupId)) {
    await loadWorkgroupSession(workgroupId);
  }
  state.activeView = "messages";
  if (state.messageSearchQuery.trim()) {
    scheduleMessageSearch();
  }
  render();
  focusComposerAtEnd();
}

async function applyWorkgroupSelectionFromMain(workgroupId: string | null): Promise<void> {
  if (!workgroupId) {
    if (state.projectId) {
      return;
    }
    if (state.workgroupId === null) {
      return;
    }
    setActiveWorkgroup(null);
    if (state.messageSearchQuery.trim()) {
      scheduleMessageSearch();
    }
    render();
    return;
  }

  await selectWorkgroup(workgroupId);
}

function clearMessageSearchResults(): void {
  state.messageSearchWorkspaceKey = null;
  state.messageSearchProjectResults = null;
  state.messageSearchWorkgroupResults = null;
  state.messageSearchLoading = false;
}

async function runMessageSearchForCurrentWorkspace(): Promise<void> {
  const query = state.messageSearchQuery.trim();
  const workspaceKey = getCurrentWorkspaceSearchKey();
  if (!query || !workspaceKey) {
    clearMessageSearchResults();
    renderPanelOnly();
    return;
  }

  state.messageSearchLoading = true;
  state.messageSearchWorkspaceKey = workspaceKey;
  renderPanelOnly();

  if (state.projectId && api.searchProjectMessages) {
    const result = await api.searchProjectMessages({
      projectId: state.projectId,
      query,
      conversationId: getCurrentSession()?.activeConversationId ?? undefined,
      limit: 200,
    });
    if (state.messageSearchWorkspaceKey !== workspaceKey || state.messageSearchQuery.trim() !== query) {
      return;
    }
    state.messageSearchProjectResults = result.success ? (result.items ?? []) : [];
    state.messageSearchWorkgroupResults = null;
    state.messageSearchLoading = false;
    renderPanelOnly();
    return;
  }

  if (state.workgroupId && api.searchWorkgroupCollaborationMessages) {
    const result = await api.searchWorkgroupCollaborationMessages({
      workgroupId: state.workgroupId,
      query,
      limit: 200,
    });
    if (state.messageSearchWorkspaceKey !== workspaceKey || state.messageSearchQuery.trim() !== query) {
      return;
    }
    state.messageSearchWorkgroupResults = result.success ? (result.items ?? []) : [];
    state.messageSearchProjectResults = null;
    state.messageSearchLoading = false;
    renderPanelOnly();
    return;
  }

  state.messageSearchLoading = false;
  renderPanelOnly();
}

function scheduleMessageSearch(): void {
  if (messageSearchTimer) {
    window.clearTimeout(messageSearchTimer);
    messageSearchTimer = null;
  }
  messageSearchTimer = window.setTimeout(() => {
    messageSearchTimer = null;
    void runMessageSearchForCurrentWorkspace();
  }, 120);
}

async function loadOlderHistory(kind: "messages" | "activities" | "cli"): Promise<void> {
  if (kind === "activities") {
    return;
  }

  if (kind === "messages" && state.messageSearchQuery.trim()) {
    return;
  }

  if (state.workgroupId) {
    if (kind !== "messages" || !api.getWorkgroupCollaborationHistoryPage) {
      return;
    }

    const historyState = getWorkgroupHistoryState(state.workgroupId);
    if (!historyState || !historyState.hasMoreMessages || historyState.loadingMessages) {
      return;
    }

    const beforeId = historyState.messages[0]?.id;
    if (!beforeId) {
      return;
    }

    const previousScrollHeight = elements.messages?.scrollHeight ?? 0;
    const previousScrollTop = elements.messages?.scrollTop ?? 0;
    historyState.loadingMessages = true;
    try {
      const result = await api.getWorkgroupCollaborationHistoryPage({
        workgroupId: state.workgroupId,
        beforeId,
        limit: 30,
      });
      if (!result.success || !result.page) {
        setHintText(result.error ?? inlineText("Failed to load earlier history.", "Failed to load earlier history."), true);
        return;
      }

      const currentHistory = getWorkgroupHistoryState(state.workgroupId);
      if (!currentHistory) {
        return;
      }
      currentHistory.messages = prependHistoryItems(currentHistory.messages, result.page.items);
      currentHistory.hasMoreMessages = result.page.hasMore;
      renderPanelOnly();
      if (elements.messages) {
        elements.messages.scrollTop = elements.messages.scrollHeight - previousScrollHeight + previousScrollTop;
      }
    } finally {
      historyState.loadingMessages = false;
    }
    return;
  }

  if (!state.projectId || !api.getProjectHistoryPage) {
    return;
  }

  const session = getCurrentSession();
  const historyState = getProjectHistoryState(state.projectId);
  if (!session || !historyState) {
    return;
  }

  const loadingKind = kind === "messages" ? "messages" : "cli";
  const hasMore = loadingKind === "messages"
    ? historyState.hasMoreMessages
    : historyState.hasMoreCli;
  const isLoading = loadingKind === "messages"
    ? historyState.loadingMessages
    : historyState.loadingCli;
  if (!hasMore) {
    return;
  }
  if (isLoading) {
    return;
  }

  const items = loadingKind === "messages"
    ? historyState.messages
    : historyState.cliTrace;
  const beforeId = items[0]?.id;
  if (!beforeId) {
    return;
  }

  const container = loadingKind === "messages"
    ? elements.messages
    : elements.cliTrace;
  const previousScrollHeight = container?.scrollHeight ?? 0;
  const previousScrollTop = container?.scrollTop ?? 0;

  if (loadingKind === "messages") {
    historyState.loadingMessages = true;
  } else {
    historyState.loadingCli = true;
  }

  try {
    const result = await api.getProjectHistoryPage({
      projectId: state.projectId,
      kind,
      conversationId: session.activeConversationId,
      beforeId,
      limit: 30,
    });

    if (!result.success || !result.page) {
      setHintText(result.error ?? inlineText("Failed to load earlier history.", "Failed to load earlier history."), true);
      return;
    }
    const page = result.page;

    const currentHistory = getProjectHistoryState(state.projectId);
    if (!currentHistory || currentHistory.conversationId !== page.conversationId) {
      return;
    }

    if (loadingKind === "messages") {
      currentHistory.messages = prependHistoryItems(currentHistory.messages, page.items as SessionMessage[]);
      currentHistory.hasMoreMessages = page.hasMore;
    } else {
      currentHistory.cliTrace = prependHistoryItems(currentHistory.cliTrace, page.items as CliTraceEntry[]);
      currentHistory.hasMoreCli = page.hasMore;
    }

    renderPanelOnly();
    if (container) {
      container.scrollTop = container.scrollHeight - previousScrollHeight + previousScrollTop;
    }
  } finally {
    if (loadingKind === "messages") {
      historyState.loadingMessages = false;
    } else {
      historyState.loadingCli = false;
    }
  }
}

async function pickAttachments(kind: AttachmentKind): Promise<void> {
  if ((kind === "image" && !supportsDesktopCapability("messageAttachmentImages"))
    || (kind === "file" && !supportsDesktopCapability("messageAttachmentFiles"))) {
    return;
  }
  if (!state.projectId || !api.pickProjectAttachments) {
    return;
  }

  const result = await api.pickProjectAttachments({
    projectId: state.projectId,
    kind,
  });

  if (!result.success) {
    setHintText(result.error ?? inlineText("Failed to add attachments.", "Failed to add attachments."), true);
    return;
  }

  const attachments = result.attachments ?? [];
  if (attachments.length === 0) {
    return;
  }

  state.pendingAttachments = mergeAttachments(state.pendingAttachments, attachments);
  persistWorkspaceDraft(getCurrentWorkspaceKey());
  renderPendingAttachments();
  setHintText(
    inlineText(
      `${state.pendingAttachments.length} attachment(s) ready to send.`,
      `${state.pendingAttachments.length} attachment(s) ready to send.`, 
    ),
    false,
  );
}

function removePendingAttachment(attachmentId: string): void {
  state.pendingAttachments = state.pendingAttachments.filter((attachment) => attachment.id !== attachmentId);
  persistWorkspaceDraft(getCurrentWorkspaceKey());
  renderPendingAttachments();
}

async function submitPrompt(): Promise<void> {
  if (!elements.composerInput) {
    return;
  }

  const rawPrompt = elements.composerInput.value.replace(/\r\n/g, "\n");
  const workspaceKey = getCurrentWorkspaceKey();
  if (state.workgroupId) {
    if (!api.sendWorkgroupCollaborationMessage) {
      return;
    }
    if (!rawPrompt.trim()) {
      setHintMessage("terminal.hint.emptyPrompt", "Prompt cannot be empty.", undefined, true);
      return;
    }

    const result = await api.sendWorkgroupCollaborationMessage({
      workgroupId: state.workgroupId,
      content: rawPrompt,
    });
    if (!result.success) {
      setHintText(result.error ?? inlineText("Failed to send message.", "Failed to send message."), true);
      return;
    }

    elements.composerInput.value = "";
    clearWorkspaceDraft(workspaceKey);
    state.pendingAttachments = [];
    renderPendingAttachments();
    hideMentionSuggestions();
    elements.composerInput.focus();
    setHintText(
      inlineText("Message sent to the collaboration group.", "Message sent to the collaboration group."),
      false,
    );
    return;
  }

  if (!state.projectId) {
    return;
  }

  const attachments = [...state.pendingAttachments];
  if (!rawPrompt.trim() && attachments.length === 0) {
    setHintMessage("terminal.hint.emptyPrompt", "Prompt cannot be empty.", undefined, true);
    return;
  }
  const prompt = buildComposerPrompt(rawPrompt, attachments);

  const session = getCurrentSession();
  setHintText(
    session?.isRunning
      ? inlineText("Queued behind the current run.", "Queued behind the current run.")
      : msg("terminal.hint.queued", "Queued for execution. Full-auto mode is active."),
    false,
  );
  const result = await api.sendProjectPrompt({
    projectId: state.projectId,
    prompt,
    attachments,
    reasoningEffort: getComposerReasoningEffortForSend(),
  });

  if (!result.success) {
    setHintText(result.error ?? msg("terminal.error.sendPrompt", "Failed to send prompt"), true);
    return;
  }

  elements.composerInput.value = "";
  state.pendingAttachments = [];
  clearWorkspaceDraft(workspaceKey);
  renderPendingAttachments();
  hideMentionSuggestions();
  elements.composerInput.focus();
}

async function stopActiveRun(): Promise<void> {
  if (!state.projectId) {
    return;
  }

  const result = await api.stopProjectRun(state.projectId);
  if (!result.success) {
    setHintText(
      result.error ?? inlineText("Failed to stop the current run.", "Failed to stop the current run."),
      true,
    );
    return;
  }

  setHintText(
    inlineText("Stopping the current run.", "Stopping the current run."),
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
    setHintText(result.error ?? inlineText("Failed to remove queued prompt.", "Failed to remove queued prompt."), true);
    return;
  }

  setHintText(inlineText("Queued prompt removed.", "Queued prompt removed."), false);
}

function translateWorkgroupRole(role: WorkgroupMemberState["role"]): string {
  if (role === "project_manager") {
    return inlineText("PM", "项目经理");
  }
  return inlineText("Member", "成员");
}

async function steerQueuedRun(runId: string): Promise<void> {
  if (!state.projectId || !api.steerQueuedProjectPrompt) return;
  const result = await api.steerQueuedProjectPrompt({ projectId: state.projectId, runId });
  setHintText(
    result.success
      ? inlineText("Guidance added to the active Codex turn.", "引导消息已并入当前 Codex turn。")
      : (result.error ?? inlineText("Failed to add guidance.", "引导失败。")),
    !result.success,
  );
}

function hideMentionSuggestions(): void {
  mentionState.query = "";
  mentionState.rangeStart = -1;
  mentionState.rangeEnd = -1;
  mentionState.activeIndex = 0;
  mentionState.items = [];
  elements.mentionSuggestions?.classList.add("hidden");
  if (elements.mentionSuggestions && renderSignatures.mentions !== "") {
    renderSignatures.mentions = "";
    elements.mentionSuggestions.innerHTML = "";
  }
}

function getMentionableMembers(): MentionSuggestionItem[] {
  const session = getCurrentWorkgroupSession();
  const members = session?.members
    ?.filter((member) => member.name.trim())
    .map((member) => ({
      key: `member:${member.id}`,
      token: member.name.trim(),
      label: member.name.trim(),
      role: member.role,
      kind: "member" as const,
      searchText: member.name.trim().toLowerCase(),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, getLocale(), { sensitivity: "base" })) ?? [];

  return [
    {
      key: "special:all",
      token: "all",
      label: "all",
      role: null,
      kind: "special",
      searchText: "all everyone broadcast",
    },
    ...members,
  ];
}

function renderMentionSuggestions(): void {
  if (!elements.mentionSuggestions || mentionState.items.length === 0) {
    hideMentionSuggestions();
    return;
  }

  const markup = mentionState.items.map((item, index) => {
    const meta = item.kind === "member"
      ? (item.role ? translateWorkgroupRole(item.role) : inlineText("Member", "成员"))
      : inlineText("Everyone in the collaboration", "协作组内全部成员");
    const tag = item.kind === "member"
      ? inlineText("Member", "成员")
      : inlineText("All", "全部");
    return [
      `<button class="mention-suggestion-item${index === mentionState.activeIndex ? " active" : ""}" type="button" data-mention-index="${index}">`,
      '<div class="mention-suggestion-main">',
      `<span class="mention-suggestion-name">@${escapeHtml(item.label)}</span>`,
      `<span class="mention-suggestion-meta">${escapeHtml(meta)}</span>`,
      "</div>",
      `<span class="mention-suggestion-tag">${escapeHtml(tag)}</span>`,
      "</button>",
    ].join("");
  }).join("");
  if (renderSignatures.mentions !== markup) {
    renderSignatures.mentions = markup;
    elements.mentionSuggestions.innerHTML = markup;
  }
  elements.mentionSuggestions.classList.remove("hidden");
}

function refreshMentionSuggestions(): void {
  const input = elements.composerInput;
  if (!input || !state.workgroupId) {
    hideMentionSuggestions();
    return;
  }

  const caret = input.selectionStart ?? 0;
  const beforeCaret = input.value.slice(0, caret);
  const mentionMatch = /(^|\s)@([^\s@]*)$/.exec(beforeCaret);
  if (!mentionMatch) {
    hideMentionSuggestions();
    return;
  }

  const rangeStart = caret - mentionMatch[2].length - 1;
  if (rangeStart < 0) {
    hideMentionSuggestions();
    return;
  }

  const query = mentionMatch[2].trim().toLowerCase();
  const items = getMentionableMembers().filter((item) => {
    if (!query) {
      return true;
    }
    return item.searchText.includes(query) || item.label.toLowerCase().includes(query);
  });

  if (items.length === 0) {
    hideMentionSuggestions();
    return;
  }

  mentionState.query = query;
  mentionState.rangeStart = rangeStart;
  mentionState.rangeEnd = caret;
  mentionState.items = items;
  mentionState.activeIndex = Math.min(mentionState.activeIndex, items.length - 1);
  renderMentionSuggestions();
}

function applyMentionSuggestion(index: number): boolean {
  const input = elements.composerInput;
  const item = mentionState.items[index];
  if (!input || !item || mentionState.rangeStart < 0 || mentionState.rangeEnd < mentionState.rangeStart) {
    return false;
  }

  input.value = `${input.value.slice(0, mentionState.rangeStart)}@${item.token} ${input.value.slice(mentionState.rangeEnd)}`;
  const caret = mentionState.rangeStart + item.token.length + 2;
  input.setSelectionRange(caret, caret);
  hideMentionSuggestions();
  input.focus();
  return true;
}

function getWorkgroupStatusMeta(workgroupId: string): { label: string; tone: string; detail: string } {
  const workgroup = state.workgroups.find((entry) => entry.id === workgroupId) ?? null;
  const session = state.sessionsByWorkgroupId.get(workgroupId) ?? null;
  const memberCount = session?.members.length ?? workgroup?.memberCount ?? 0;
  if (!workgroup) {
    return {
      label: inlineText("Idle", "空闲"),
      tone: "idle",
      detail: inlineText("Collaboration unavailable", "协作不可用"),
    };
  }

  if (session?.isRunning || workgroup.isRunning) {
    const runningMembers = (session?.members ?? []).filter((member) => member.isRunning).map((member) => member.name);
    return {
      label: inlineText("Running", "运行中"),
      tone: "running",
      detail: runningMembers.length > 0
        ? runningMembers.join(", ")
        : inlineText("Members are responding", "成员正在回复"),
    };
  }

  const latestMessage = session?.messages[session.messages.length - 1] ?? null;
  if (latestMessage?.content?.trim()) {
    return {
      label: inlineText("Ready", "就绪"),
      tone: "ready",
      detail: latestMessage.content.trim().replace(/\s+/g, " ").slice(0, 120),
    };
  }

  return {
    label: inlineText("Ready", "就绪"),
    tone: "ready",
    detail: inlineText(`${memberCount} members in collaboration`, `协作组内有 ${memberCount} 名成员`),
  };
}

let modelPickerEl: HTMLDivElement | null = null;

function closeModelPicker(): void {
  modelPickerEl?.remove();
  modelPickerEl = null;
}

async function switchProjectModel(projectId: string, provider: "claude" | "codex", model: string | null): Promise<void> {
  const normalized = model?.trim() ?? "";
  const updateResult = await api.updateProject?.({
    projectId,
    updates: {
      cliProvider: provider,
      cliModel: normalized || null,
    },
  });
  if (updateResult && !updateResult.success) {
    setHintText(updateResult.error ?? inlineText("Failed to update project model", "更新项目模型失败"), true);
    return;
  }

  const result = await api.sendProjectPrompt({
    projectId,
    prompt: normalized ? `/model ${normalized}` : "/model auto",
  });

  if (!result.success) {
    setHintText(result.error ?? inlineText("Failed to switch model", "切换模型失败"), true);
    return;
  }

  setHintText(inlineText("Model update queued.", "模型切换已加入队列。"), false);
  elements.composerInput?.focus();
}

async function openModelPicker(anchor: HTMLElement, options: { force?: boolean } = {}): Promise<void> {
  const project = getCurrentProject();
  if (!project) {
    return;
  }

  const session = getCurrentSession();
  const currentProvider = getConfiguredProvider(project, session);
  const currentModel = getConfiguredModel(project, session)?.trim() ?? "";
  const providers = await buildModelProviderOptions(project, session, options);
  const initialProviderIndex = Math.max(0, providers.findIndex((option) => (
    option.protocol === providerProtocol(currentProvider)
    && (
      option.models.some((model) => model.toLowerCase() === currentModel.toLowerCase())
      || option.defaultModel?.toLowerCase() === currentModel.toLowerCase()
      || !currentModel
    )
  )));

  closeModelPicker();
  const picker = document.createElement("div");
  picker.className = "model-switch-menu";
  picker.setAttribute("role", "menu");

  const header = document.createElement("div");
  header.className = "model-switch-menu-header";
  header.textContent = inlineText("Switch model", "切换模型");
  picker.appendChild(header);

  const providerLabelEl = document.createElement("label");
  providerLabelEl.className = "model-switch-field";
  const providerCaption = document.createElement("span");
  providerCaption.textContent = inlineText("Provider", "厂商");
  const providerSelect = document.createElement("select");
  providerSelect.className = "model-switch-select";
  providers.forEach((option, index) => {
    const item = document.createElement("option");
    item.value = String(index);
    item.textContent = option.name;
    providerSelect.appendChild(item);
  });
  providerSelect.value = String(initialProviderIndex);
  providerLabelEl.append(providerCaption, providerSelect);

  const modelLabelEl = document.createElement("label");
  modelLabelEl.className = "model-switch-field";
  const modelCaption = document.createElement("span");
  modelCaption.textContent = inlineText("Model", "具体模型");
  const modelSelect = document.createElement("select");
  modelSelect.className = "model-switch-select";
  modelLabelEl.append(modelCaption, modelSelect);

  const detail = document.createElement("div");
  detail.className = "model-switch-option-detail";
  const providerMeta = document.createElement("div");
  providerMeta.className = "model-switch-provider-meta";
  const providerProtocolBadge = document.createElement("span");
  providerProtocolBadge.className = "model-switch-source-chip";
  const providerSourceBadge = document.createElement("span");
  providerSourceBadge.className = "model-switch-source-chip";
  providerMeta.append(providerProtocolBadge, providerSourceBadge);

  const actions = document.createElement("div");
  actions.className = "model-switch-actions";
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "model-switch-action secondary";
  refreshButton.textContent = inlineText("Refresh list", "刷新列表");
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "model-switch-action secondary";
  cancelButton.textContent = inlineText("Cancel", "取消");
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "model-switch-action primary";
  applyButton.textContent = inlineText("Apply", "应用");
  actions.append(refreshButton, cancelButton, applyButton);

  function getSelectedProviderOption(): ModelProviderOption {
    return providers[Number(providerSelect.value)] ?? providers[0];
  }

  function syncModelSelect(): void {
    const option = getSelectedProviderOption();
    const models = mergeModelValues([
      option.protocol === providerProtocol(currentProvider) ? currentModel : null,
      option.defaultModel,
      ...option.models,
    ]);
    modelSelect.innerHTML = "";
    const autoOption = document.createElement("option");
    autoOption.value = "";
    autoOption.textContent = modelLabel(null);
    modelSelect.appendChild(autoOption);
    for (const model of models) {
      const item = document.createElement("option");
      item.value = model;
      item.textContent = model;
      modelSelect.appendChild(item);
    }
    modelSelect.value = option.protocol === providerProtocol(currentProvider) && currentModel
      ? currentModel
      : (option.defaultModel ?? "");
    providerProtocolBadge.textContent = option.protocol === "anthropic" ? "Anthropic" : "OpenAI";
    providerSourceBadge.textContent = providerOptionSourceLabel(option);
    detail.textContent = providerOptionDetail(option);
  }

  providerSelect.addEventListener("change", syncModelSelect);
  cancelButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeModelPicker();
  });
  refreshButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closeModelPicker();
    setHintText(inlineText("Refreshing model list...", "正在刷新模型列表..."), false);
    void openModelPicker(anchor, { force: true });
  });
  applyButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const option = getSelectedProviderOption();
    closeModelPicker();
    void switchProjectModel(project.id, providerForProtocol(option.protocol), modelSelect.value || null);
  });

  picker.append(providerLabelEl, modelLabelEl, providerMeta, detail, actions);
  syncModelSelect();

  document.body.appendChild(picker);
  const rect = anchor.getBoundingClientRect();
  const pickerWidth = 360;
  picker.style.width = `${pickerWidth}px`;
  picker.style.left = `${Math.max(12, Math.min(window.innerWidth - pickerWidth - 12, rect.left))}px`;
  picker.style.top = `${Math.max(12, Math.min(window.innerHeight - picker.offsetHeight - 12, rect.bottom + 8))}px`;
  modelPickerEl = picker;
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

elements.voiceInputBtn?.addEventListener("click", () => {
  startVoiceInput();
});

elements.voiceInputModeSelect?.addEventListener("change", (event) => {
  const value = (event.target as HTMLSelectElement | null)?.value;
  voiceInputMode = value === "send" ? "send" : "transcribe";
  persistVoiceInputMode();
  updateVoiceInputButton();
  setHintText(
    voiceInputMode === "send"
      ? inlineText("Voice input will send recognized text directly.", "语音识别后会直接发送。")
      : inlineText("Voice input will transcribe into the input box.", "语音识别后会转成输入框文字。"),
    false,
  );
});

elements.composerInput?.addEventListener("keydown", (event) => {
  if (event.isComposing) {
    return;
  }

  if (mentionState.items.length > 0) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      mentionState.activeIndex = (mentionState.activeIndex + 1) % mentionState.items.length;
      renderMentionSuggestions();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      mentionState.activeIndex = (mentionState.activeIndex - 1 + mentionState.items.length) % mentionState.items.length;
      renderMentionSuggestions();
      return;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      if (applyMentionSuggestion(mentionState.activeIndex)) {
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideMentionSuggestions();
      return;
    }
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submitPrompt();
  }
});

elements.composerInput?.addEventListener("input", () => {
  persistWorkspaceDraft(getCurrentWorkspaceKey());
  syncComposerInputHeight();
  refreshMentionSuggestions();
});

elements.composerInput?.addEventListener("click", () => {
  refreshMentionSuggestions();
});

elements.composerInput?.addEventListener("keyup", (event) => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    refreshMentionSuggestions();
  }
});

elements.composerInput?.addEventListener("blur", () => {
  window.setTimeout(() => {
    hideMentionSuggestions();
  }, 120);
});

elements.composerInput?.addEventListener("paste", (event) => {
  if (!supportsDesktopCapability("clipboardImagePaste")) {
    return;
  }
  const items = Array.from(event.clipboardData?.items ?? []);
  if (!items.some((item) => item.type.startsWith("image/"))) {
    return;
  }

  event.preventDefault();
  void saveClipboardImageAttachment();
});

elements.mentionSuggestions?.addEventListener("mousedown", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const item = target?.closest("[data-mention-index]") as HTMLElement | null;
  const index = Number(item?.dataset.mentionIndex ?? -1);
  if (index < 0) {
    return;
  }
  event.preventDefault();
  applyMentionSuggestion(index);
});

elements.projectSearchInput?.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | null;
  state.projectSearchQuery = target?.value ?? "";
  scheduleProjectSearchRender();
});

elements.sidebarProjectsTab?.addEventListener("click", () => {
  setSidebarMode("messages");
});

elements.sidebarWorkgroupsTab?.addEventListener("click", () => {
  setSidebarMode("contacts");
});

elements.messageSearchInput?.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement | null;
  state.messageSearchQuery = target?.value ?? "";
  if (!state.messageSearchQuery.trim()) {
    clearMessageSearchResults();
    renderPanelOnly();
    return;
  }
  scheduleMessageSearch();
});

elements.projectList?.addEventListener("click", (event) => {
  closeTemporaryAccessContextMenu();
  const target = event.target instanceof Element ? event.target : null;
  const header = target?.closest("[data-group-header]") as HTMLElement | null;
  const groupKey = header?.dataset.groupHeader;
  if (groupKey) {
    toggleGroupCollapsed(groupKey);
    return;
  }
  const workgroupItem = target?.closest("[data-workgroup-id]") as HTMLElement | null;
  const workgroupId = workgroupItem?.dataset.workgroupId;
  if (workgroupId) {
    void selectWorkgroup(workgroupId);
    return;
  }
  const item = target?.closest("[data-project-id]") as HTMLElement | null;
  const projectId = item?.dataset.projectId;
  if (!projectId) {
    return;
  }

  void selectProject(projectId);
});

elements.projectList?.addEventListener("contextmenu", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const item = target?.closest("[data-project-id]") as HTMLElement | null;
  const projectId = item?.dataset.projectId;
  if (!projectId) {
    return;
  }
  const project = getProjectById(projectId);
  if (!project) {
    return;
  }
  event.preventDefault();
  showTemporaryAccessContextMenu(project, event.clientX, event.clientY);
});

document.addEventListener("click", (event) => {
  if (!temporaryAccessContextMenu) {
    return;
  }
  const target = event.target instanceof Node ? event.target : null;
  if (target && temporaryAccessContextMenu.contains(target)) {
    return;
  }
  closeTemporaryAccessContextMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }
  closeTemporaryAccessContextMenu();
  closeTemporaryAccessDialog();
});

elements.projectList?.addEventListener("keydown", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const header = target?.closest("[data-group-header]") as HTMLElement | null;
  if (!header) {
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  const groupKey = header.dataset.groupHeader;
  if (groupKey) {
    toggleGroupCollapsed(groupKey);
  }
});

elements.projectList?.addEventListener("dragstart", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const header = target?.closest("[data-group-header]") as HTMLElement | null;
  const groupKey = header?.dataset.groupHeader;
  if (!header || !groupKey) {
    return;
  }
  draggingGroupKey = groupKey;
  dragOverGroupKey = null;
  event.dataTransfer?.setData("text/plain", groupKey);
  event.dataTransfer?.setDragImage(header, 12, 12);
  header.classList.add("drag-source");
  elements.projectList?.classList.add("is-dragging-groups");
});

elements.projectList?.addEventListener("dragover", (event) => {
  if (!draggingGroupKey) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const header = target?.closest("[data-group-header]") as HTMLElement | null;
  const groupKey = header?.dataset.groupHeader;
  if (!header || !groupKey) {
    return;
  }
  event.preventDefault();
  if (groupKey === draggingGroupKey) {
    return;
  }
  if (dragOverGroupKey !== groupKey) {
    elements.projectList?.querySelectorAll(".project-group.drag-over").forEach((node) => {
      node.classList.remove("drag-over");
    });
    const group = header.closest(".project-group");
    group?.classList.add("drag-over");
    dragOverGroupKey = groupKey;
  }
});

elements.projectList?.addEventListener("drop", (event) => {
  if (!draggingGroupKey) {
    return;
  }
  const target = event.target instanceof Element ? event.target : null;
  const header = target?.closest("[data-group-header]") as HTMLElement | null;
  const groupKey = header?.dataset.groupHeader;
  if (groupKey) {
    event.preventDefault();
    applyGroupOrderFromDrag(draggingGroupKey, groupKey);
  }
});

elements.projectList?.addEventListener("dragend", () => {
  draggingGroupKey = null;
  dragOverGroupKey = null;
  elements.projectList?.querySelectorAll(".project-group.drag-over").forEach((node) => {
    node.classList.remove("drag-over");
  });
  elements.projectList?.querySelectorAll(".project-group-header.drag-source").forEach((node) => {
    node.classList.remove("drag-source");
  });
  elements.projectList?.classList.remove("is-dragging-groups");
});

elements.queueList?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const steerButton = target?.closest("[data-queue-steer]") as HTMLElement | null;
  const steerRunId = steerButton?.dataset.queueSteer;
  if (steerRunId) {
    void steerQueuedRun(steerRunId);
    return;
  }
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
  const copyButton = target?.closest("[data-copy-message-id]") as HTMLElement | null;
  const messageId = copyButton?.dataset.copyMessageId;
  if (messageId) {
    void copyVisibleMessage(messageId);
    return;
  }
  const previewTrigger = target?.closest("[data-preview-attachment]") as HTMLElement | null;
  const attachmentId = previewTrigger?.dataset.previewAttachment;
  if (!attachmentId) {
    return;
  }

  void openAttachmentPreview(attachmentId);
});

elements.activityList?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const copyButton = target?.closest("[data-copy-activity-id]") as HTMLElement | null;
  const activityId = copyButton?.dataset.copyActivityId;
  if (!activityId) {
    return;
  }

  void copyVisibleActivity(activityId);
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
  render({
    staticI18n: false,
    projectList: false,
    header: false,
    workbench: true,
    panel: true,
    attachments: false,
    lightbox: false,
    hint: false,
  });
});

elements.modelBadge?.addEventListener("click", (event) => {
  event.stopPropagation();
  void openModelPicker(event.currentTarget as HTMLElement);
});

elements.composerModelBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  void openModelPicker(event.currentTarget as HTMLElement);
});

document.addEventListener("click", (event) => {
  if (!modelPickerEl) {
    return;
  }
  const target = event.target instanceof Node ? event.target : null;
  if (target && modelPickerEl.contains(target)) {
    return;
  }
  closeModelPicker();
});

elements.composerRunModeSelect?.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement | null;
  const nextMode = isComposerRunMode(target?.value) ? target.value : "normal";
  const project = getCurrentProject();
  const session = getCurrentSession();
  const provider = getConfiguredProvider(project, session);
  const enabled = Boolean(project && provider === "codex" && !state.workgroupId);
  state.composerRunMode = enabled ? nextMode : "normal";
  syncComposerRunModeSelect(
    enabled,
    inlineText("Plan and goal modes are available for Codex projects", "计划和目标模式仅在 Codex 项目中可用"),
  );
  setHintText(
    state.composerRunMode === "normal"
      ? inlineText("Normal mode selected.", "已选择普通模式。")
      : inlineText(
          `${composerRunModeLabel(state.composerRunMode)} mode selected for the next prompt.`,
          `下一条提示词将使用${composerRunModeLabel(state.composerRunMode)}模式。`,
        ),
    false,
  );
});

elements.composerReasoningSelect?.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement | null;
  const nextEffort = isComposerReasoningEffort(target?.value) ? target.value : "auto";
  const project = getCurrentProject();
  const session = getCurrentSession();
  const provider = getConfiguredProvider(project, session);
  const enabled = Boolean(project && provider === "codex" && !state.workgroupId);
  state.composerReasoningEffort = enabled ? nextEffort : "auto";
  syncComposerReasoningSelect(
    enabled,
    inlineText("Reasoning effort is available for Codex projects", "推理强度仅在 Codex 项目中可用"),
  );
  setHintText(
    state.composerReasoningEffort === "auto"
      ? inlineText("Reasoning effort set to auto.", "推理强度已设为自动。")
      : inlineText(
          `Reasoning effort set to ${composerReasoningLabel(state.composerReasoningEffort)} for the next prompt.`,
          `下一条提示词推理强度：${composerReasoningLabel(state.composerReasoningEffort)}。`,
        ),
    false,
  );
});

elements.conversationSelect?.addEventListener("change", async (event) => {
  const target = event.target as HTMLSelectElement | null;
  const conversationId = target?.value?.trim();
  if (!state.projectId || !conversationId || !api.activateProjectConversation) {
    return;
  }

  const result = await api.activateProjectConversation({
    projectId: state.projectId,
    conversationId,
  });
  if (!result.success) {
    setHintText(result.error ?? inlineText("Failed to switch conversation.", "Failed to switch conversation."), true);
    return;
  }
  focusComposerAtEnd();
});

elements.newConversationBtn?.addEventListener("click", async () => {
  if (!state.projectId || !api.createProjectConversation) {
    return;
  }

  const result = await api.createProjectConversation(state.projectId);
  if (!result.success) {
    setHintText(result.error ?? inlineText("Failed to create a new conversation.", "Failed to create a new conversation."), true);
    return;
  }
  setHintText(inlineText("Started a new conversation.", "Started a new conversation."), false);
  focusComposerAtEnd();
});

elements.messages?.addEventListener("scroll", () => {
  updateMessagesJumpButtonVisibility();
  if (elements.messages && elements.messages.scrollTop <= 24) {
    void loadOlderHistory("messages");
  }
});

elements.messagesJumpButton?.addEventListener("click", () => {
  scheduleMessagesScrollToBottom();
});

elements.activityList?.addEventListener("scroll", () => {
  updateActivityJumpButtonVisibility();
});

elements.activityJumpButton?.addEventListener("click", () => {
  scheduleActivitiesScrollToBottom();
});

elements.cliTrace?.addEventListener("scroll", () => {
  if (elements.cliTrace && elements.cliTrace.scrollTop <= 24) {
    void loadOlderHistory("cli");
  }
});

api.onProjectId((projectId) => {
  void applyProjectSelectionFromMain(projectId);
});

api.onWorkgroupCollaborationId?.((workgroupId) => {
  void applyWorkgroupSelectionFromMain(workgroupId);
});

api.onProjectSessionSnapshot((snapshot) => {
  const nextSignature = buildSessionSnapshotSignature(snapshot);
  if (lastProjectSnapshotSignatureByProjectId.get(snapshot.projectId) === nextSignature) {
    return;
  }
  lastProjectSnapshotSignatureByProjectId.set(snapshot.projectId, nextSignature);
  state.sessionsByProjectId.set(snapshot.projectId, snapshot);
  syncHistoryStateFromSnapshot(snapshot);
  if (snapshot.projectId === state.projectId) {
    syncActiveViewForCurrentProject();
    if (state.messageSearchQuery.trim()) {
      scheduleMessageSearch();
    }
    scheduleWorkspaceRender();
  }
  scheduleProjectListRender(snapshot.projectId === state.projectId ? 160 : 260);
});

api.onProjectsChanged?.((projects) => {
  void syncProjects(projects);
});

api.onWorkgroupCollaborationSummaries?.((workgroups) => {
  void syncWorkgroups(workgroups);
});

api.onWorkgroupCollaborationSnapshot?.((snapshot) => {
  const nextSignature = buildWorkgroupSessionSnapshotSignature(snapshot);
  if (lastWorkgroupSnapshotSignatureById.get(snapshot.workgroupId) === nextSignature) {
    return;
  }
  lastWorkgroupSnapshotSignatureById.set(snapshot.workgroupId, nextSignature);
  state.sessionsByWorkgroupId.set(snapshot.workgroupId, snapshot);
  syncWorkgroupHistoryStateFromSnapshot(snapshot);
  if (snapshot.workgroupId === state.workgroupId && state.messageSearchQuery.trim()) {
    scheduleMessageSearch();
  }
  if (snapshot.workgroupId === state.workgroupId) {
    refreshMentionSuggestions();
    scheduleWorkspaceRender();
  }
  scheduleProjectListRender(snapshot.workgroupId === state.workgroupId ? 160 : 260);
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
bindClick("serverSettingsBtn", () => api.openSettingsWindow?.("connection"));
bindClick("projectSettingsBtn", () => api.openSettingsWindow?.("project"));
bindClick("settingsBtn", () => api.openSettingsWindow?.("system"));
bindClick("closeBtn", () => {
  if (typeof api.closeWindow === "function") {
    api.closeWindow();
    return;
  }
  window.close();
});

document.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement as HTMLElement | null;
  const isEditableTarget = activeElement instanceof HTMLInputElement
    || activeElement instanceof HTMLTextAreaElement
    || Boolean(activeElement?.isContentEditable);

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    elements.messageSearchInput?.focus();
    elements.messageSearchInput?.select();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.projectSearchInput?.focus();
    elements.projectSearchInput?.select();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "j") {
    event.preventDefault();
    scheduleMessagesScrollToBottom();
    return;
  }

  if (event.key === "Escape" && state.attachmentPreview) {
    closeAttachmentPreview();
    return;
  }

  if (event.key === "Escape" && mentionState.items.length > 0) {
    hideMentionSuggestions();
    return;
  }

  if (event.key === "Escape" && activeElement === elements.messageSearchInput) {
    const messageSearchInput = elements.messageSearchInput;
    if (!messageSearchInput) {
      return;
    }
    if (messageSearchInput.value.trim()) {
      messageSearchInput.value = "";
      state.messageSearchQuery = "";
      clearMessageSearchResults();
      renderPanelOnly();
    } else {
      focusComposerAtEnd();
    }
    return;
  }

  if (event.key === "Escape" && activeElement === elements.projectSearchInput) {
    const projectSearchInput = elements.projectSearchInput;
    if (!projectSearchInput) {
      return;
    }
    if (projectSearchInput.value.trim()) {
      projectSearchInput.value = "";
      state.projectSearchQuery = "";
      scheduleProjectSearchRender();
    } else {
      focusComposerAtEnd();
    }
    return;
  }

  if (!isEditableTarget && event.key === "/") {
    event.preventDefault();
    elements.messageSearchInput?.focus();
    elements.messageSearchInput?.select();
  }
});

hydrateProjectGroupState();
void loadI18n();
void syncProjects();
void syncWorkgroups();
syncComposerInputHeight();
render();
