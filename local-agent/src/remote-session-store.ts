import { EventEmitter } from "events";
import * as fs from "fs";
import { v4 as uuidv4 } from "uuid";
import {
  createSessionSyncAttachmentsMd5,
  createSessionSyncContentMd5,
} from "./session-sync-hash";
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
import { SessionSyncActions } from "./session-sync-actions";
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
  content_md5?: string;
  content_omitted?: boolean;
  attachments?: RunAttachment[];
  attachments_md5?: string | null;
  attachments_omitted?: boolean;
  status: string;
  title?: string;
  activity_kind?: string;
  cli_stream?: "system" | "stdout" | "stderr";
}

type LooseRecord = Record<string, unknown>;

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

interface PendingHistoryRequest {
  projectId: string;
  kind: HistoryPageKind;
  beforeId: string;
  beforeSeq: number;
  limit: number;
  conversationId: string | null;
  timeout: NodeJS.Timeout;
  resolve: (page: HistoryPageResult<SessionMessage | SessionActivity | CliTraceEntry>) => void;
}

interface PendingUploadAck {
  attachment: RunAttachment;
  timeout: NodeJS.Timeout;
  resolve: (attachment: RunAttachment) => void;
  reject: (error: Error) => void;
}

interface RemoteRunObserver {
  onTextDelta?: (chunk: string) => void;
  onDone?: () => void;
  onError?: (error: string) => void;
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_REMOTE_ITEMS = 1200;
const FILE_CHUNK_SIZE = 64 * 1024;
const FILE_UPLOAD_TIMEOUT_MS = 120_000;
const EMPTY_PROJECT_LIST_RETRY_DELAY_MS = 1_500;
const MAX_CONSECUTIVE_EMPTY_PROJECT_LISTS = 2;

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

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

export default class RemoteSessionStore extends EventEmitter {
  private readonly relayClient: RelayClient;
  private readonly localAgentId: () => string;
  private readonly states = new Map<string, RemoteState>();
  private readonly emptyProjectListCounts = new Map<string, number>();
  private readonly emptyProjectListRetryTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingHistoryRequests = new Map<string, PendingHistoryRequest[]>();
  private readonly pendingUploadAcks = new Map<string, PendingUploadAck>();
  private readonly runObservers = new Map<string, RemoteRunObserver>();

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
      case Events.FILE_DONE:
        this.handleFileDone(env);
        return;
      case Events.FILE_ERROR:
        this.handleFileError(env);
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

  getProjectAgentId(projectId: string): string | null {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) {
      return null;
    }
    return this.states.get(normalizedProjectId)?.project.agentId ?? null;
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
    const totals = this.getConversationTotals(state);
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
      messageTotal: totals.messageTotal,
      activityTotal: totals.activityTotal,
      cliTraceTotal: totals.cliTraceTotal,
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
      hasMore: startIndex > 0 || this.getTotalForKind(state, kind) > safeAnchorIndex,
      total: this.getTotalForKind(state, kind),
    };
  }

  searchMessages(
    projectId: string,
    request: {
      query: string;
      conversationId?: string | null;
      limit?: number;
    },
  ): SessionMessage[] | null {
    const state = this.states.get(projectId);
    if (!state) {
      return null;
    }

    const query = request.query.trim().toLowerCase();
    if (!query) {
      return [];
    }

    if (request.conversationId && state.activeConversationId && request.conversationId !== state.activeConversationId) {
      return [];
    }

    const limit = Number(request.limit) > 0 ? Math.max(1, Number(request.limit)) : 200;
    return state.messages
      .filter((message) => {
        const attachmentText = (message.attachments ?? [])
          .map((attachment) => `${attachment.name} ${attachment.path}`)
          .join(" ")
          .toLowerCase();
        const haystack = [
          message.role,
          message.provider ?? "",
          message.content,
          attachmentText,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .slice(-limit)
      .map(cloneMessage);
  }

  async loadHistoryPage(
    projectId: string,
    kind: HistoryPageKind,
    request: {
      beforeId?: string | null;
      limit?: number;
      conversationId?: string | null;
    } = {},
  ): Promise<HistoryPageResult<SessionMessage | SessionActivity | CliTraceEntry> | null> {
    const state = this.states.get(projectId);
    if (!state) {
      return null;
    }

    const limit = Number(request.limit) > 0 ? Number(request.limit) : DEFAULT_PAGE_SIZE;
    const beforeId = request.beforeId?.trim() ?? "";
    const localPage = this.getHistoryPage(projectId, kind, {
      beforeId,
      limit,
    });
    if (!localPage || !beforeId) {
      return localPage;
    }
    if (localPage.items.length > 0 || !localPage.hasMore) {
      return localPage;
    }

    const beforeSeq = this.findEntrySyncSeq(state, kind, beforeId);
    if (beforeSeq <= 0) {
      return localPage;
    }

    return await new Promise((resolve) => {
      const pending: PendingHistoryRequest = {
        projectId,
        kind,
        beforeId,
        beforeSeq,
        limit,
        conversationId: request.conversationId?.trim() || state.activeConversationId,
        timeout: setTimeout(() => {
          this.removePendingHistoryRequest(projectId, pending);
          resolve(this.getHistoryPage(projectId, kind, { beforeId, limit }) ?? localPage);
        }, 15000),
        resolve,
      };
      const requests = this.pendingHistoryRequests.get(projectId) ?? [];
      requests.push(pending);
      this.pendingHistoryRequests.set(projectId, requests);

      this.requestSessionSync(projectId, {
        beforeSeq,
        limit,
        conversationId: pending.conversationId,
      });
    });
  }

  requestSessionSync(projectId: string, options: {
    afterSeq?: number;
    beforeSeq?: number;
    limit?: number;
    action?: string;
    conversationId?: string | null;
    runId?: string | null;
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
        run_id: options.runId ?? undefined,
        known_items: this.buildKnownSyncItems(projectId, options),
      },
    });
  }

  async sendPrompt(
    projectId: string,
    prompt: string,
    attachments?: RunAttachment[],
    options: {
      runId?: string;
      onTextDelta?: (chunk: string) => void;
      onDone?: () => void;
      onError?: (error: string) => void;
    } = {},
  ): Promise<{ success: boolean; runId?: string; error?: string }> {
    const state = this.states.get(projectId);
    if (!state) {
      return { success: false, error: "Remote project not found" };
    }

    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      return { success: false, error: "Prompt cannot be empty" };
    }

    let uploadedAttachments: RunAttachment[] | undefined;
    if (attachments && attachments.length > 0) {
      try {
        uploadedAttachments = [];
        for (const attachment of attachments) {
          uploadedAttachments.push(await this.uploadAttachment(projectId, attachment));
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const runId = options.runId?.trim() || uuidv4();
    const streamId = `${runId}:assistant`;
    const timestamp = Date.now();
    state.messages.push({
      id: runId,
      role: "user",
      content: trimmedPrompt,
      attachments: cloneAttachments(uploadedAttachments),
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
        attachments: cloneAttachments(uploadedAttachments),
      },
    });
    if (options.onTextDelta || options.onDone || options.onError) {
      this.runObservers.set(this.getRunObserverKey(projectId, runId), {
        onTextDelta: options.onTextDelta,
        onDone: options.onDone,
        onError: options.onError,
      });
    }
    return { success: true, runId };
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

  removeQueuedRun(projectId: string, runId: string): { success: boolean; error?: string } {
    const state = this.states.get(projectId);
    if (!state) {
      return { success: false, error: "Remote project not found" };
    }

    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return { success: false, error: "Queued run id is required" };
    }

    const currentLength = state.queue.length;
    state.queue = state.queue.filter((entry) => entry.runId !== normalizedRunId);
    if (state.queue.length === currentLength) {
      return { success: false, error: "Queued item not found" };
    }
    state.queuedCount = state.queue.length;
    this.emitSnapshot(projectId);

    this.requestSessionSync(projectId, {
      action: SessionSyncActions.REMOVE_QUEUE,
      runId: normalizedRunId,
      limit: DEFAULT_PAGE_SIZE,
    });
    return { success: true };
  }

  createConversation(projectId: string): { success: boolean; conversationId?: string; error?: string } {
    if (!this.states.has(projectId)) {
      return { success: false, error: "Remote project not found" };
    }
    this.requestSessionSync(projectId, {
      action: SessionSyncActions.NEW_CONVERSATION,
      limit: DEFAULT_PAGE_SIZE,
    });
    return { success: true };
  }

  activateConversation(projectId: string, conversationId: string): { success: boolean; error?: string } {
    if (!this.states.has(projectId)) {
      return { success: false, error: "Remote project not found" };
    }
    this.requestSessionSync(projectId, {
      action: SessionSyncActions.SWITCH_CONVERSATION,
      conversationId,
      limit: DEFAULT_PAGE_SIZE,
    });
    return { success: true };
  }

  private handleProjectListed(env: Envelope): void {
    const payload = (env.payload ?? {}) as LooseRecord;
    const agentID = readString(payload.agent_id).trim();
    const localAgentID = this.localAgentId().trim();
    if (!agentID || agentID === localAgentID) {
      return;
    }

    const listedProjects = Array.isArray(payload.projects) ? payload.projects as LooseRecord[] : [];
    const existingAgentProjectIDs = Array.from(this.states.entries())
      .filter(([, state]) => state.project.agentId === agentID)
      .map(([projectId]) => projectId);
    if (listedProjects.length === 0) {
      const emptyCount = (this.emptyProjectListCounts.get(agentID) ?? 0) + 1;
      this.emptyProjectListCounts.set(agentID, emptyCount);
      if (existingAgentProjectIDs.length > 0 && emptyCount < MAX_CONSECUTIVE_EMPTY_PROJECT_LISTS) {
        this.scheduleEmptyProjectListRetry(agentID);
        this.emit("projects-changed", this.getProjects());
        return;
      }
    } else {
      this.emptyProjectListCounts.delete(agentID);
      this.clearEmptyProjectListRetry(agentID);
    }

    const nextIDs = new Set<string>();
    for (const item of listedProjects) {
      const projectID = readString(item?.id).trim();
      const projectAgentID = readString(item?.agentId ?? item?.agent_id).trim() || agentID;
      if (!projectID || !projectAgentID) {
        continue;
      }
      const record: RemoteProjectRecord = {
        id: projectID,
        agentId: projectAgentID,
        name: readString(item?.name).trim() || projectID,
        path: readString(item?.path).trim(),
        groupName: readString(item?.groupName ?? item?.group_name).trim() || null,
        cliProvider: readString(item?.cliProvider ?? item?.cli_provider) === "codex" ? "codex" : "claude",
        cliModel: readString(item?.cliModel ?? item?.cli_model).trim() || null,
        online: item?.online !== false,
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
        this.pendingHistoryRequests.delete(projectId);
        this.states.delete(projectId);
      }
    }
    if (listedProjects.length === 0) {
      this.clearEmptyProjectListRetry(agentID);
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

    const payload = (env.payload ?? {}) as LooseRecord;
    state.provider = readString(payload.provider) === "codex" ? "codex" : "claude";
    state.model = readString(payload.model).trim() || null;
    state.isRunning = Boolean(payload.isRunning ?? payload.is_running);
    state.queuedCount = readNumber(payload.queuedCount ?? payload.queued_count);
    const currentSource = readString(payload.currentSource ?? payload.current_source);
    state.currentSource = currentSource === "remote" ? "remote" : (currentSource === "desktop" ? "desktop" : null);
    state.currentPrompt = readString(payload.currentPrompt ?? payload.current_prompt) || null;
    state.currentStartedAt = readNumber(payload.currentStartedAt ?? payload.current_started_at) || null;
    state.activeConversationId = readString(payload.active_conversation_id ?? payload.activeConversationId) || null;
    state.queue = Array.isArray(payload.queue)
      ? payload.queue.map((entry: any) => ({
          runId: readString(entry.runId ?? entry.run_id).trim() || uuidv4(),
          prompt: readString(entry.prompt),
          source: readString(entry.source) === "remote" ? "remote" : "desktop",
          queuedAt: readNumber(entry.queuedAt ?? entry.queued_at) || Date.now(),
          attachments: cloneAttachments(entry.attachments),
        }))
      : [];
    state.conversations = Array.isArray(payload.conversations)
      ? payload.conversations.map((entry: any) => ({
          id: readString(entry.id).trim() || uuidv4(),
          title: readString(entry.title) || "New conversation",
          createdAt: readNumber(entry.created_at ?? entry.createdAt) || Date.now(),
          updatedAt: readNumber(entry.updated_at ?? entry.updatedAt) || Date.now(),
          isActive: Boolean(entry.is_active),
          messageCount: readNumber(entry.message_count ?? entry.messageCount),
          activityCount: readNumber(entry.activity_count ?? entry.activityCount),
          cliCount: readNumber(entry.cli_count ?? entry.cliCount),
        }))
      : [];

    const sync = (payload.sync ?? {}) as LooseRecord;
    const items = Array.isArray(sync?.items) ? sync.items as SyncItemPayload[] : [];
    const latestSeq = readNumber(sync.latest_seq ?? sync.latestSeq);
    for (const item of items) {
      this.applySyncItem(state, item);
    }
    state.lastSyncSeq = Math.max(state.lastSyncSeq, latestSeq);
    this.resolvePendingHistoryRequests(projectId, readNumber(sync.before_seq ?? sync.beforeSeq));
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

  private scheduleEmptyProjectListRetry(agentID: string): void {
    if (!agentID || this.emptyProjectListRetryTimers.has(agentID)) {
      return;
    }
    const timer = setTimeout(() => {
      this.emptyProjectListRetryTimers.delete(agentID);
      this.requestProjectList();
    }, EMPTY_PROJECT_LIST_RETRY_DELAY_MS);
    this.emptyProjectListRetryTimers.set(agentID, timer);
  }

  private clearEmptyProjectListRetry(agentID: string): void {
    const timer = this.emptyProjectListRetryTimers.get(agentID);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.emptyProjectListRetryTimers.delete(agentID);
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

    const runObserver = this.runObservers.get(this.getRunObserverKey(projectId, this.getRunIdFromStreamId(streamId)));
    runObserver?.onTextDelta?.(content);

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
    const payload = env.payload as { error?: string } | undefined;
    const message = state.messages.find((entry) => entry.id === streamId);
    if (message) {
      message.status = "done";
      message.updatedAt = Date.now();
    }
    const runId = this.getRunIdFromStreamId(streamId);
    const runObserverKey = this.getRunObserverKey(projectId, runId);
    const runObserver = this.runObservers.get(runObserverKey);
    if (env.event === Events.MESSAGE_ERROR) {
      const errorText = String(payload?.error ?? "").trim() || "Remote run failed.";
      const errorId = `${streamId}:error`;
      const existingError = state.messages.find((entry) => entry.id === errorId);
      if (existingError) {
        existingError.content = errorText;
        existingError.updatedAt = Date.now();
        existingError.status = "done";
      } else {
        state.messages.push({
          id: errorId,
          role: "error",
          content: errorText,
          source: "remote",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "done",
          syncSeq: state.lastSyncSeq,
        });
      }
      this.trimMessages(state);
      runObserver?.onError?.(errorText);
    } else {
      runObserver?.onDone?.();
    }
    this.runObservers.delete(runObserverKey);
    this.emitSnapshot(projectId);
  }

  private getRunObserverKey(projectId: string, runId: string): string {
    return `${projectId}:${runId}`;
  }

  private getRunIdFromStreamId(streamId: string): string {
    return streamId.endsWith(":assistant")
      ? streamId.slice(0, -":assistant".length)
      : streamId;
  }

  private handleFileDone(env: Envelope): void {
    const payload = env.payload as Record<string, unknown> | undefined;
    const fileId = String(payload?.file_id ?? env.stream_id ?? "").trim();
    if (!fileId) {
      return;
    }

    const pending = this.pendingUploadAcks.get(fileId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingUploadAcks.delete(fileId);
    pending.resolve({
      ...pending.attachment,
      path: String(payload?.file_path ?? pending.attachment.path).trim() || pending.attachment.path,
      size: Number(payload?.file_size ?? pending.attachment.size) || pending.attachment.size,
      kind: payload?.kind === "image" ? "image" : (payload?.kind === "file" ? "file" : pending.attachment.kind),
      mimeType: typeof payload?.mime_type === "string" && payload.mime_type.trim()
        ? payload.mime_type.trim()
        : pending.attachment.mimeType,
      previewDataUrl: typeof payload?.preview_data_url === "string" && payload.preview_data_url.trim()
        ? payload.preview_data_url.trim()
        : pending.attachment.previewDataUrl,
    });
  }

  private handleFileError(env: Envelope): void {
    const payload = env.payload as Record<string, unknown> | undefined;
    const fileId = String(env.stream_id ?? payload?.file_id ?? "").trim();
    if (!fileId) {
      return;
    }

    const pending = this.pendingUploadAcks.get(fileId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingUploadAcks.delete(fileId);
    const message = typeof payload?.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : "Remote desktop failed to receive attachment.";
    pending.reject(new Error(message));
  }

  private applySyncItem(state: RemoteState, item: SyncItemPayload): void {
    const itemRecord = item as unknown as LooseRecord;
    const itemId = readString(item.id ?? itemRecord.id).trim();
    const itemKind = readString(item.kind ?? itemRecord.kind);
    const itemCreatedAt = readNumber(item.createdAt ?? itemRecord.created_at);
    const itemUpdatedAt = readNumber(item.updatedAt ?? itemRecord.updated_at);
    const itemSeq = readNumber(item.seq ?? itemRecord.seq);
    if (!item || !itemId) {
      return;
    }

    if (itemKind === "message") {
      const existingMessage = state.messages.find((entry) => entry.id === itemId);
      const contentMd5 = readString(item.content_md5 ?? itemRecord.content_md5).trim();
      const attachmentsMd5 = readString(item.attachments_md5 ?? itemRecord.attachments_md5).trim();
      const contentOmitted = Boolean(item.content_omitted ?? itemRecord.content_omitted);
      const attachmentsOmitted = Boolean(item.attachments_omitted ?? itemRecord.attachments_omitted);
      const nextMessage: RemoteMessageEntry = {
        id: itemId,
        role: item.role === "user" ? "user" : (item.role === "error" ? "error" : "assistant"),
        content: contentOmitted && existingMessage && createSessionSyncContentMd5(existingMessage.content) === contentMd5
          ? existingMessage.content
          : readString(item.content ?? itemRecord.content),
        attachments: attachmentsOmitted && existingMessage
          && createSessionSyncAttachmentsMd5(existingMessage.attachments) === attachmentsMd5
          ? cloneAttachments(existingMessage.attachments)
          : cloneAttachments(item.attachments),
        source: item.role === "user" ? "desktop" : "remote",
        createdAt: itemCreatedAt,
        updatedAt: itemUpdatedAt,
        status: item.status === "streaming" ? "streaming" : "done",
        syncSeq: itemSeq,
      };
      const index = state.messages.findIndex((entry) => entry.id === itemId);
      if (index >= 0) {
        state.messages[index] = nextMessage;
      } else {
        state.messages.push(nextMessage);
      }
      this.trimMessages(state);
      return;
    }

    if (itemKind === "cli") {
      const existingEntry = state.cliTrace.find((entry) => entry.id === itemId);
      const contentMd5 = readString(item.content_md5 ?? itemRecord.content_md5).trim();
      const contentOmitted = Boolean(item.content_omitted ?? itemRecord.content_omitted);
      const nextEntry: RemoteCliEntry = {
        id: itemId,
        stream: item.cli_stream === "stderr" ? "stderr" : (item.cli_stream === "system" ? "system" : "stdout"),
        text: contentOmitted && existingEntry && createSessionSyncContentMd5(existingEntry.text) === contentMd5
          ? existingEntry.text
          : readString(item.content ?? itemRecord.content),
        createdAt: itemCreatedAt,
        syncSeq: itemSeq,
      };
      const index = state.cliTrace.findIndex((entry) => entry.id === itemId);
      if (index >= 0) {
        state.cliTrace[index] = nextEntry;
      } else {
        state.cliTrace.push(nextEntry);
      }
      this.trimCli(state);
      return;
    }

    const existingActivity = state.activities.find((entry) => entry.id === itemId);
    const contentMd5 = readString(item.content_md5 ?? itemRecord.content_md5).trim();
    const contentOmitted = Boolean(item.content_omitted ?? itemRecord.content_omitted);
    const nextActivity: RemoteActivityEntry = {
      id: itemId,
      kind: itemKind === "thinking"
        ? "thinking"
        : ((item.activity_kind as SessionActivity["kind"]) || "status"),
      title: readString(item.title ?? itemRecord.title) || (itemKind === "thinking" ? "Thinking" : "Activity"),
      detail: contentOmitted && existingActivity && createSessionSyncContentMd5(existingActivity.detail) === contentMd5
        ? existingActivity.detail
        : readString(item.content ?? itemRecord.content),
      status: this.mapActivityStatus(item.status),
      createdAt: itemCreatedAt,
      updatedAt: itemUpdatedAt,
      syncSeq: itemSeq,
    };
    const index = state.activities.findIndex((entry) => entry.id === itemId);
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

  private buildKnownSyncItems(projectId: string, options: {
    afterSeq?: number;
    beforeSeq?: number;
    limit?: number;
  }): Array<{ id: string; content_md5: string; attachments_md5?: string }> {
    const state = this.states.get(projectId);
    if (!state) {
      return [];
    }

    const afterSeq = Number(options.afterSeq) > 0 ? Number(options.afterSeq) : 0;
    if (afterSeq > 0 && !(Number(options.beforeSeq) > 0)) {
      return [];
    }

    const beforeSeq = Number(options.beforeSeq) > 0 ? Number(options.beforeSeq) : 0;
    const limit = Number(options.limit) > 0 ? Math.max(20, Number(options.limit) * 2) : (DEFAULT_PAGE_SIZE * 2);
    const items: Array<{ id: string; content_md5: string; attachments_md5?: string; seq: number }> = [];

    for (const message of state.messages) {
      if (beforeSeq > 0 && message.syncSeq >= beforeSeq) {
        continue;
      }
      items.push({
        id: message.id,
        content_md5: createSessionSyncContentMd5(message.content),
        attachments_md5: createSessionSyncAttachmentsMd5(message.attachments) ?? undefined,
        seq: message.syncSeq,
      });
    }

    for (const activity of state.activities) {
      if (beforeSeq > 0 && activity.syncSeq >= beforeSeq) {
        continue;
      }
      items.push({
        id: activity.id,
        content_md5: createSessionSyncContentMd5(activity.detail),
        seq: activity.syncSeq,
      });
    }

    for (const entry of state.cliTrace) {
      if (beforeSeq > 0 && entry.syncSeq >= beforeSeq) {
        continue;
      }
      items.push({
        id: entry.id,
        content_md5: createSessionSyncContentMd5(entry.text),
        seq: entry.syncSeq,
      });
    }

    return items
      .sort((left, right) => right.seq - left.seq)
      .slice(0, limit)
      .map(({ seq: _seq, ...item }) => item);
  }

  private async uploadAttachment(projectId: string, attachment: RunAttachment): Promise<RunAttachment> {
    const resolvedPath = attachment.path?.trim() ?? "";
    if (!resolvedPath || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      throw new Error(`Attachment not found: ${attachment.name}`);
    }

    const uploaded = await new Promise<RunAttachment>(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingUploadAcks.delete(attachment.id);
        reject(new Error(`Timed out while uploading ${attachment.name}.`));
      }, FILE_UPLOAD_TIMEOUT_MS);

      this.pendingUploadAcks.set(attachment.id, {
        attachment,
        timeout,
        resolve,
        reject,
      });

      try {
        this.relayClient.send({
          id: attachment.id,
          event: Events.FILE_UPLOAD,
          project_id: projectId,
          ts: Date.now(),
          payload: {
            file_name: attachment.name,
            file_size: attachment.size,
            mime_type: attachment.mimeType,
          },
        });

        let seq = 0;
        for await (const chunk of fs.createReadStream(resolvedPath, { highWaterMark: FILE_CHUNK_SIZE })) {
          const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          this.relayClient.send({
            id: uuidv4(),
            event: Events.FILE_CHUNK,
            project_id: projectId,
            stream_id: attachment.id,
            seq,
            ts: Date.now(),
            payload: {
              file_id: attachment.id,
              chunk: chunkBuffer.toString("base64"),
              seq,
            },
          });
          seq += 1;
        }

        this.relayClient.send({
          id: uuidv4(),
          event: Events.FILE_DONE,
          project_id: projectId,
          stream_id: attachment.id,
          ts: Date.now(),
          payload: {
            file_id: attachment.id,
            file_name: attachment.name,
          },
        });
      } catch (error) {
        clearTimeout(timeout);
        this.pendingUploadAcks.delete(attachment.id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    return uploaded;
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

  private getConversationTotals(state: RemoteState): {
    messageTotal: number;
    activityTotal: number;
    cliTraceTotal: number;
  } {
    const activeConversation = state.conversations.find((conversation) => conversation.id === state.activeConversationId)
      ?? state.conversations.find((conversation) => conversation.isActive)
      ?? null;
    if (!activeConversation) {
      return {
        messageTotal: state.messages.length,
        activityTotal: state.activities.length,
        cliTraceTotal: state.cliTrace.length,
      };
    }

    return {
      messageTotal: Math.max(activeConversation.messageCount, state.messages.length),
      activityTotal: Math.max(activeConversation.activityCount, state.activities.length),
      cliTraceTotal: Math.max(activeConversation.cliCount, state.cliTrace.length),
    };
  }

  private getTotalForKind(state: RemoteState, kind: HistoryPageKind): number {
    const totals = this.getConversationTotals(state);
    if (kind === "messages") {
      return totals.messageTotal;
    }
    if (kind === "activities") {
      return totals.activityTotal;
    }
    return totals.cliTraceTotal;
  }

  private findEntrySyncSeq(state: RemoteState, kind: HistoryPageKind, entryId: string): number {
    if (!entryId) {
      return 0;
    }

    const source = kind === "messages"
      ? state.messages
      : (kind === "activities" ? state.activities : state.cliTrace);
    const target = source.find((entry) => entry.id === entryId);
    return Number(target?.syncSeq ?? 0) || 0;
  }

  private resolvePendingHistoryRequests(projectId: string, requestedBeforeSeq: number): void {
    if (requestedBeforeSeq <= 0) {
      return;
    }

    const requests = this.pendingHistoryRequests.get(projectId);
    if (!requests || requests.length === 0) {
      return;
    }

    const remaining: PendingHistoryRequest[] = [];
    for (const request of requests) {
      if (request.beforeSeq !== requestedBeforeSeq) {
        remaining.push(request);
        continue;
      }

      clearTimeout(request.timeout);
      request.resolve(
        this.getHistoryPage(projectId, request.kind, {
          beforeId: request.beforeId,
          limit: request.limit,
        }) ?? {
          conversationId: request.conversationId,
          items: [],
          hasMore: false,
          total: 0,
        },
      );
    }

    if (remaining.length > 0) {
      this.pendingHistoryRequests.set(projectId, remaining);
    } else {
      this.pendingHistoryRequests.delete(projectId);
    }
  }

  private removePendingHistoryRequest(projectId: string, request: PendingHistoryRequest): void {
    const requests = this.pendingHistoryRequests.get(projectId);
    if (!requests || requests.length === 0) {
      return;
    }

    const nextRequests = requests.filter((entry) => entry !== request);
    if (nextRequests.length > 0) {
      this.pendingHistoryRequests.set(projectId, nextRequests);
    } else {
      this.pendingHistoryRequests.delete(projectId);
    }
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
