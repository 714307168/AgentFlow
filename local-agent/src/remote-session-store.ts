import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type {
  CliProvider,
  CliTraceEntry,
  ConversationSummary,
  HistoryPageKind,
  HistoryPageResult,
  ProjectSessionSnapshot,
  QueuedRunSnapshot,
  RunAttachment,
  SessionActivity,
  SessionMessage,
} from "./runtime-types";
import type RelayClient from "./relay-client";
import { Envelope, Events } from "./types";

export interface RemoteProjectInfo {
  id: string;
  agentId: string;
  name: string;
  path: string;
  groupName?: string | null;
  cliProvider: CliProvider;
  cliModel?: string | null;
  online?: boolean;
}

export interface RemoteProjectRecord extends RemoteProjectInfo {
  isRemote: true;
}

interface SyncItemPayload {
  id: string;
  kind: "message" | "thinking" | "activity" | "cli";
  seq: number;
  createdAt: number;
  updatedAt: number;
  role?: SessionMessage["role"];
  content: string;
  attachments?: RunAttachment[];
  status: string;
  title?: string;
  activity_kind?: string;
  cli_stream?: "system" | "stdout" | "stderr";
}

interface RemoteMessageEntry extends SessionMessage {
  syncSeq: number;
}

interface RemoteActivityEntry extends SessionActivity {
  syncSeq: number;
}

interface RemoteCliEntry extends CliTraceEntry {
  syncSeq: number;
}

interface RemoteState {
  project: RemoteProjectRecord;
  provider: CliProvider;
  model: string | null;
  isRunning: boolean;
  queuedCount: number;
  currentSource: "remote" | "desktop" | null;
  currentPrompt: string | null;
  currentStartedAt: number | null;
  activeConversationId: string | null;
  conversations: ConversationSummary[];
  queue: QueuedRunSnapshot[];
  messages: RemoteMessageEntry[];
  activities: RemoteActivityEntry[];
  cliTrace: RemoteCliEntry[];
  lastSyncSeq: number;
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_REMOTE_ITEMS = 400;

function cloneAttachments(attachments?: RunAttachment[]): RunAttachment[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }
  return attachments.map((attachment) => ({ ...attachment }));
}

function cloneMessage(message: RemoteMessageEntry): SessionMessage {
  return {
    ...message,
    attachments: cloneAttachments(message.attachments),
  };
}

export default class RemoteSessionStore extends EventEmitter {
  private readonly relayClient: RelayClient;
  private readonly localAgentId: () => string;
  private readonly states = new Map<string, RemoteState>();

  constructor(relayClient: RelayClient, options: { localAgentId: () => string }) {
    super();
    this.relayClient = relayClient;
    this.localAgentId = options.localAgentId;
  }

  requestProjectList(): void {
    this.relayClient.send({
      id: uuidv4(),
      event: Events.PROJECT_LIST_REQUEST,
      ts: Date.now(),
    });
  }

  handleEnvelope(env: Envelope): void {
    switch (env.event) {
      case Events.PROJECT_LISTED:
        this.handleProjectListed(env);
        return;
      case Events.SESSION_SYNC:
        this.handleSessionSync(env);
        return;
      case Events.AGENT_STATUS:
        this.handleAgentStatus(env);
        return;
      case Events.MESSAGE_CHUNK:
        this.handleMessageChunk(env);
        return;
      case Events.MESSAGE_DONE:
      case Events.MESSAGE_ERROR:
        this.handleMessageCompleted(env);
        return;
      default:
        return;
    }
  }

  getProjects(): RemoteProjectRecord[] {
    return Array.from(this.states.values())
      .map((state) => ({ ...state.project }))
      .sort((left, right) => right.name.localeCompare(left.name, "zh-CN"));
  }

  hasProject(projectId: string): boolean {
    return this.states.has(projectId);
  }

  getProject(projectId: string): RemoteProjectRecord | null {
    const state = this.states.get(projectId);
    return state ? { ...state.project } : null;
  }

  getSnapshot(projectId: string): ProjectSessionSnapshot | null {
    const state = this.states.get(projectId);
    if (!state) {
      return null;
    }
    return {
      projectId,
      provider: state.provider,
      model: state.model,
      automationMode: "full-auto",
      isRunning: state.isRunning,
      queuedCount: state.queuedCount,
      currentSource: state.currentSource,
      currentPrompt: state.currentPrompt,
      currentStartedAt: state.currentStartedAt,
      activeConversationId: state.activeConversationId,
      conversations: state.conversations.map((conversation) => ({ ...conversation })),
      messageTotal: state.messages.length,
      activityTotal: state.activities.length,
      cliTraceTotal: state.cliTrace.length,
      queue: state.queue.map((entry) => ({
        ...entry,
        attachments: cloneAttachments(entry.attachments),
      })),
      cliTrace: state.cliTrace.slice(-DEFAULT_PAGE_SIZE).map((entry) => ({ ...entry })),
      messages: state.messages.slice(-DEFAULT_PAGE_SIZE).map(cloneMessage),
      activities: state.activities.slice(-DEFAULT_PAGE_SIZE).map((entry) => ({ ...entry })),
      sessionRefs: {
        claudeSessionId: null,
        codexThreadId: null,
      },
    };
  }

  getHistoryPage(
    projectId: string,
    kind: HistoryPageKind,
    request: {
      beforeId?: string | null;
      limit?: number;
    } = {},
  ): HistoryPageResult<SessionMessage | SessionActivity | CliTraceEntry> | null {
    const state = this.states.get(projectId);
    if (!state) {
      return null;
    }

    const source = kind === "messages"
      ? state.messages
      : (kind === "activities" ? state.activities : state.cliTrace);
    const limit = Number(request.limit) > 0 ? Number(request.limit) : DEFAULT_PAGE_SIZE;
    const beforeId = request.beforeId?.trim() ?? "";
    const anchorIndex = beforeId
      ? source.findIndex((entry) => entry.id === beforeId)
      : source.length;
    const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : source.length;
    const startIndex = Math.max(0, safeAnchorIndex - limit);
    const items = source.slice(startIndex, safeAnchorIndex).map((entry) => {
      if (kind === "messages") {
        return cloneMessage(entry as RemoteMessageEntry);
      }
      return { ...(entry as SessionActivity | CliTraceEntry) };
    });

    return {
      conversationId: state.activeConversationId,
      items,
      hasMore: startIndex > 0,
      total: source.length,
    };
  }

  requestSessionSync(projectId: string, options: {
    afterSeq?: number;
    beforeSeq?: number;
    limit?: number;
    action?: string;
    conversationId?: string | null;
  } = {}): void {
    this.relayClient.send({
      id: uuidv4(),
      event: Events.SESSION_SYNC_REQUEST,
      project_id: projectId,
      ts: Date.now(),
      payload: {
        after_seq: options.afterSeq ?? 0,
        before_seq: options.beforeSeq,
        limit: options.limit,
        action: options.action,
        conversation_id: options.conversationId ?? undefined,
      },
    });
  }

  sendPrompt(projectId: string, prompt: string, attachments?: RunAttachment[]): { success: boolean; error?: string } {
    const state = this.states.get(projectId);
    if (!state) {
      return { success: false, error: "Remote project not found" };
    }
    if (attachments && attachments.length > 0) {
      return { success: false, error: "Remote project attachments are not supported yet" };
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return { success: false, error: "Prompt cannot be empty" };
    }

    const runId = uuidv4();
    const streamId = `${runId}:assistant`;
    const timestamp = Date.now();
    state.messages.push({
      id: runId,
      role: "user",
      content: trimmedPrompt,
      source: "desktop",
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "done",
      syncSeq: state.lastSyncSeq,
    });
    this.trimMessages(state);
    this.emitSnapshot(projectId);

    this.relayClient.send({
      id: runId,
      event: Events.MESSAGE_SEND,
      project_id: projectId,
      stream_id: streamId,
      ts: timestamp,
      payload: {
        content: trimmedPrompt,
      },
    });
    this.requestSessionSync(projectId, { afterSeq: Math.max(0, state.lastSyncSeq - DEFAULT_PAGE_SIZE), limit: DEFAULT_PAGE_SIZE });
    return { success: true };
  }

  stopRun(projectId: string): { success: boolean; error?: string } {
    if (!this.states.has(projectId)) {
      return { success: false, error: "Remote project not found" };
    }
    this.relayClient.send({
      id: uuidv4(),
      event: Events.TASK_STOP,
      project_id: projectId,
      ts: Date.now(),
    });
    return { success: true };
  }

  createConversation(projectId: string): { success: boolean; conversationId?: string; error?: string } {
    if (!this.states.has(projectId)) {
      return { success: false, error: "Remote project not found" };
    }
    this.requestSessionSync(projectId, {
      action: "new_conversation",
      limit: DEFAULT_PAGE_SIZE,
    });
    return { success: true };
  }

  activateConversation(projectId: string, conversationId: string): { success: boolean; error?: string } {
    if (!this.states.has(projectId)) {
      return { success: false, error: "Remote project not found" };
    }
    this.requestSessionSync(projectId, {
      action: "switch_conversation",
      conversationId,
      limit: DEFAULT_PAGE_SIZE,
    });
    return { success: true };
  }

  private handleProjectListed(env: Envelope): void {
    const payload = env.payload as { agent_id?: string; projects?: RemoteProjectInfo[] } | undefined;
    const agentID = payload?.agent_id?.trim() ?? "";
    const localAgentID = this.localAgentId().trim();
    if (!agentID || agentID === localAgentID) {
      return;
    }

    const listedProjects = Array.isArray(payload?.projects) ? payload.projects : [];
    const nextIDs = new Set<string>();
    for (const item of listedProjects) {
      if (!item?.id || !item.agentId && !agentID) {
        continue;
      }
      const record: RemoteProjectRecord = {
        id: item.id,
        agentId: item.agentId?.trim() || agentID,
        name: item.name,
        path: item.path,
        groupName: item.groupName ?? null,
        cliProvider: item.cliProvider === "codex" ? "codex" : "claude",
        cliModel: item.cliModel ?? null,
        online: item.online ?? true,
        isRemote: true,
      };
      nextIDs.add(record.id);
      const existing = this.states.get(record.id);
      this.states.set(record.id, existing ? {
        ...existing,
        project: record,
        provider: record.cliProvider,
        model: record.cliModel ?? existing.model,
      } : this.createState(record));
    }

    for (const [projectId, state] of this.states.entries()) {
      if (state.project.agentId === agentID && !nextIDs.has(projectId)) {
        this.states.delete(projectId);
      }
    }
    this.emit("projects-changed", this.getProjects());
  }

  private handleSessionSync(env: Envelope): void {
    const projectId = env.project_id?.trim() ?? "";
    if (!projectId) {
      return;
    }
    const state = this.states.get(projectId);
    if (!state) {
      return;
    }

    const payload = env.payload as any;
    state.provider = payload?.provider === "codex" ? "codex" : "claude";
    state.model = typeof payload?.model === "string" ? payload.model : null;
    state.isRunning = Boolean(payload?.isRunning);
    state.queuedCount = Number(payload?.queuedCount ?? 0) || 0;
    state.currentSource = payload?.currentSource === "remote" ? "remote" : (payload?.currentSource === "desktop" ? "desktop" : null);
    state.currentPrompt = typeof payload?.currentPrompt === "string" ? payload.currentPrompt : null;
    state.currentStartedAt = Number(payload?.currentStartedAt) || null;
    state.activeConversationId = typeof payload?.active_conversation_id === "string" ? payload.active_conversation_id : null;
    state.queue = Array.isArray(payload?.queue)
      ? payload.queue.map((entry: any) => ({
          runId: String(entry.runId ?? uuidv4()),
          prompt: String(entry.prompt ?? ""),
          source: entry.source === "remote" ? "remote" : "desktop",
          queuedAt: Number(entry.queuedAt ?? Date.now()),
          attachments: cloneAttachments(entry.attachments),
        }))
      : [];
    state.conversations = Array.isArray(payload?.conversations)
      ? payload.conversations.map((entry: any) => ({
          id: String(entry.id ?? uuidv4()),
          title: String(entry.title ?? "New conversation"),
          createdAt: Number(entry.created_at ?? Date.now()),
          updatedAt: Number(entry.updated_at ?? Date.now()),
          isActive: Boolean(entry.is_active),
          messageCount: Number(entry.message_count ?? 0),
          activityCount: Number(entry.activity_count ?? 0),
          cliCount: Number(entry.cli_count ?? 0),
        }))
      : [];

    const sync = payload?.sync;
    const items = Array.isArray(sync?.items) ? sync.items as SyncItemPayload[] : [];
    const latestSeq = Number(sync?.latest_seq ?? 0) || 0;
    for (const item of items) {
      this.applySyncItem(state, item);
    }
    state.lastSyncSeq = Math.max(state.lastSyncSeq, latestSeq);
    this.emitSnapshot(projectId);
  }

  private handleAgentStatus(env: Envelope): void {
    const payload = env.payload as { project_id?: string; online?: boolean } | undefined;
    const projectId = payload?.project_id?.trim() || env.project_id?.trim() || "";
    const state = this.states.get(projectId);
    if (!state) {
      return;
    }
    state.project.online = Boolean(payload?.online);
    this.emit("projects-changed", this.getProjects());
    this.emitSnapshot(projectId);
  }

  private handleMessageChunk(env: Envelope): void {
    const projectId = env.project_id?.trim() ?? "";
    const streamId = env.stream_id?.trim() ?? "";
    const state = this.states.get(projectId);
    if (!state || !streamId) {
      return;
    }
    const payload = env.payload as { content?: string } | undefined;
    const content = String(payload?.content ?? "");
    if (!content) {
      return;
    }

    let message = state.messages.find((entry) => entry.id === streamId);
    if (!message) {
      message = {
        id: streamId,
        role: "assistant",
        content,
        source: "remote",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "streaming",
        syncSeq: state.lastSyncSeq,
      };
      state.messages.push(message);
    } else {
      message.content += content;
      message.updatedAt = Date.now();
      message.status = "streaming";
    }
    this.trimMessages(state);
    this.emitSnapshot(projectId);
  }

  private handleMessageCompleted(env: Envelope): void {
    const projectId = env.project_id?.trim() ?? "";
    const streamId = env.stream_id?.trim() ?? "";
    const state = this.states.get(projectId);
    if (!state || !streamId) {
      return;
    }
    const message = state.messages.find((entry) => entry.id === streamId);
    if (message) {
      message.status = "done";
      message.updatedAt = Date.now();
    }
    this.requestSessionSync(projectId, { afterSeq: Math.max(0, state.lastSyncSeq - DEFAULT_PAGE_SIZE), limit: DEFAULT_PAGE_SIZE });
    this.emitSnapshot(projectId);
  }

  private applySyncItem(state: RemoteState, item: SyncItemPayload): void {
    if (!item || !item.id) {
      return;
    }

    if (item.kind === "message") {
      const nextMessage: RemoteMessageEntry = {
        id: item.id,
        role: item.role === "user" ? "user" : (item.role === "error" ? "error" : "assistant"),
        content: item.content ?? "",
        attachments: cloneAttachments(item.attachments),
        source: item.role === "user" ? "desktop" : "remote",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        status: item.status === "streaming" ? "streaming" : "done",
        syncSeq: item.seq,
      };
      const index = state.messages.findIndex((entry) => entry.id === item.id);
      if (index >= 0) {
        state.messages[index] = nextMessage;
      } else {
        state.messages.push(nextMessage);
      }
      this.trimMessages(state);
      return;
    }

    if (item.kind === "cli") {
      const nextEntry: RemoteCliEntry = {
        id: item.id,
        stream: item.cli_stream === "stderr" ? "stderr" : (item.cli_stream === "system" ? "system" : "stdout"),
        text: item.content ?? "",
        createdAt: item.createdAt,
        syncSeq: item.seq,
      };
      const index = state.cliTrace.findIndex((entry) => entry.id === item.id);
      if (index >= 0) {
        state.cliTrace[index] = nextEntry;
      } else {
        state.cliTrace.push(nextEntry);
      }
      this.trimCli(state);
      return;
    }

    const nextActivity: RemoteActivityEntry = {
      id: item.id,
      kind: item.kind === "thinking"
        ? "thinking"
        : ((item.activity_kind as SessionActivity["kind"]) || "status"),
      title: item.title || (item.kind === "thinking" ? "Thinking" : "Activity"),
      detail: item.content ?? "",
      status: this.mapActivityStatus(item.status),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      syncSeq: item.seq,
    };
    const index = state.activities.findIndex((entry) => entry.id === item.id);
    if (index >= 0) {
      state.activities[index] = nextActivity;
    } else {
      state.activities.push(nextActivity);
    }
    this.trimActivities(state);
  }

  private mapActivityStatus(status: string): SessionActivity["status"] {
    if (status === "running") return "running";
    if (status === "pending") return "pending";
    if (status === "error") return "error";
    return "completed";
  }

  private emitSnapshot(projectId: string): void {
    const snapshot = this.getSnapshot(projectId);
    if (!snapshot) {
      return;
    }
    this.emit("snapshot", projectId, snapshot);
  }

  private createState(project: RemoteProjectRecord): RemoteState {
    return {
      project,
      provider: project.cliProvider,
      model: project.cliModel ?? null,
      isRunning: false,
      queuedCount: 0,
      currentSource: null,
      currentPrompt: null,
      currentStartedAt: null,
      activeConversationId: null,
      conversations: [],
      queue: [],
      messages: [],
      activities: [],
      cliTrace: [],
      lastSyncSeq: 0,
    };
  }

  private trimMessages(state: RemoteState): void {
    state.messages.sort((left, right) => left.createdAt - right.createdAt || left.syncSeq - right.syncSeq);
    if (state.messages.length > MAX_REMOTE_ITEMS) {
      state.messages.splice(0, state.messages.length - MAX_REMOTE_ITEMS);
    }
  }

  private trimActivities(state: RemoteState): void {
    state.activities.sort((left, right) => left.createdAt - right.createdAt || left.syncSeq - right.syncSeq);
    if (state.activities.length > MAX_REMOTE_ITEMS) {
      state.activities.splice(0, state.activities.length - MAX_REMOTE_ITEMS);
    }
  }

  private trimCli(state: RemoteState): void {
    state.cliTrace.sort((left, right) => left.createdAt - right.createdAt || left.syncSeq - right.syncSeq);
    if (state.cliTrace.length > MAX_REMOTE_ITEMS) {
      state.cliTrace.splice(0, state.cliTrace.length - MAX_REMOTE_ITEMS);
    }
  }
}
