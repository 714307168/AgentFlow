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
  projectPrompt?: string | null;
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
  snapshotRevision: string | null;
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
  projectId: string;
  runId: string;
  streamId: string;
  startedAt: number;
  lastActivityAt: number;
  sawResponse: boolean;
  timeout: NodeJS.Timeout | null;
  syncNudgeTimers: NodeJS.Timeout[];
  onTextDelta?: (chunk: string) => void;
  onDone?: () => void;
  onError?: (error: string) => void;
}

const DEFAULT_PAGE_SIZE = 30;
const MAX_REMOTE_ITEMS = 1200;
const MAX_REMOTE_ACTIVITY_ITEMS = 30;
const FILE_CHUNK_SIZE = 64 * 1024;
const FILE_UPLOAD_TIMEOUT_MS = 120_000;
const EMPTY_PROJECT_LIST_RETRY_DELAY_MS = 1_500;
const MAX_CONSECUTIVE_EMPTY_PROJECT_LISTS = 2;
const REMOTE_RUN_START_TIMEOUT_MS = 20_000;
const REMOTE_RUN_IDLE_TIMEOUT_MS = 120_000;
const REMOTE_RUN_MAX_LIFETIME_MS = 10 * 60_000;
const FULL_ITEM_REQUEST_DEDUPE_MS = 5_000;

function cloneAttachments(attachments?: RunAttachment[]): RunAttachment[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }
  return attachments.map((attachment) => ({ ...attachment }));
}

function attachmentsMatch(left: RunAttachment, right: RunAttachment): boolean {
  if (left.id && right.id) {
    return left.id === right.id;
  }
  return left.name === right.name
    && left.size === right.size
    && left.kind === right.kind;
}

function mergeAttachments(
  existingAttachments?: RunAttachment[],
  incomingAttachments?: RunAttachment[],
): RunAttachment[] | undefined {
  if (!incomingAttachments || incomingAttachments.length === 0) {
    return cloneAttachments(existingAttachments);
  }
  if (!existingAttachments || existingAttachments.length === 0) {
    return cloneAttachments(incomingAttachments);
  }

  const consumedExistingIndexes = new Set<number>();
  const merged: RunAttachment[] = incomingAttachments.map((incomingAttachment) => {
    const existingIndex = existingAttachments.findIndex((candidate, index) => (
      !consumedExistingIndexes.has(index) && attachmentsMatch(candidate, incomingAttachment)
    ));
    const existingAttachment = existingIndex >= 0
      ? existingAttachments[existingIndex]
      : undefined;
    if (existingIndex >= 0) {
      consumedExistingIndexes.add(existingIndex);
    }
    return {
      ...incomingAttachment,
      path: incomingAttachment.path || existingAttachment?.path || "",
      mimeType: incomingAttachment.mimeType || existingAttachment?.mimeType,
      previewDataUrl: incomingAttachment.previewDataUrl || existingAttachment?.previewDataUrl,
    };
  });

  return merged;
}

function cloneMessage(message: RemoteMessageEntry): SessionMessage {
  return {
    ...message,
    attachments: cloneAttachments(message.attachments),
  };
}

function attachmentsEqual(left?: RunAttachment[], right?: RunAttachment[]): boolean {
  const leftItems = left ?? [];
  const rightItems = right ?? [];
  if (leftItems.length !== rightItems.length) {
    return false;
  }
  for (let index = 0; index < leftItems.length; index += 1) {
    const leftItem = leftItems[index];
    const rightItem = rightItems[index];
    if (
      leftItem.id !== rightItem.id
      || leftItem.name !== rightItem.name
      || leftItem.path !== rightItem.path
      || leftItem.size !== rightItem.size
      || leftItem.kind !== rightItem.kind
      || leftItem.mimeType !== rightItem.mimeType
      || leftItem.previewDataUrl !== rightItem.previewDataUrl
    ) {
      return false;
    }
  }
  return true;
}

function conversationsEqual(left: ConversationSummary[], right: ConversationSummary[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (
      leftItem.id !== rightItem.id
      || leftItem.title !== rightItem.title
      || leftItem.createdAt !== rightItem.createdAt
      || leftItem.updatedAt !== rightItem.updatedAt
      || leftItem.isActive !== rightItem.isActive
      || leftItem.messageCount !== rightItem.messageCount
      || leftItem.activityCount !== rightItem.activityCount
      || leftItem.cliCount !== rightItem.cliCount
    ) {
      return false;
    }
  }
  return true;
}

function queueEntriesEqual(left: QueuedRunSnapshot[], right: QueuedRunSnapshot[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (
      leftItem.runId !== rightItem.runId
      || leftItem.prompt !== rightItem.prompt
      || leftItem.source !== rightItem.source
      || leftItem.queuedAt !== rightItem.queuedAt
      || !attachmentsEqual(leftItem.attachments, rightItem.attachments)
    ) {
      return false;
    }
  }
  return true;
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
  private readonly pendingFullItemRequests = new Map<string, number>();

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
      case Events.ERROR:
        this.handleRelayError(env);
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
    itemId?: string | null;
    runId?: string | null;
    projectUpdates?: {
      groupName?: string | null;
      cliProvider?: CliProvider;
      cliModel?: string | null;
      projectPrompt?: string | null;
    } | null;
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
        item_id: options.itemId ?? undefined,
        run_id: options.runId ?? undefined,
        project_updates: options.projectUpdates ? {
          group_name: options.projectUpdates.groupName ?? undefined,
          cli_provider: options.projectUpdates.cliProvider ?? undefined,
          cli_model: options.projectUpdates.cliModel ?? undefined,
          project_prompt: options.projectUpdates.projectPrompt ?? undefined,
        } : undefined,
        known_items: this.buildKnownSyncItems(projectId, options),
      },
    });
  }

  updateProjectConfig(projectId: string, updates: {
    groupName?: string | null;
    cliProvider?: CliProvider;
    cliModel?: string | null;
    projectPrompt?: string | null;
  }): { success: boolean; error?: string } {
    const state = this.states.get(projectId);
    if (!state) {
      return { success: false, error: "Remote project not found" };
    }
    if (state.project.online === false) {
      return { success: false, error: "Remote project is offline" };
    }
    if (!this.relayClient.isConnected()) {
      return { success: false, error: "Remote relay is disconnected" };
    }

    if (updates.groupName !== undefined) {
      state.project.groupName = typeof updates.groupName === "string" && updates.groupName.trim()
        ? updates.groupName.trim()
        : null;
    }
    if (updates.cliProvider !== undefined) {
      state.project.cliProvider = updates.cliProvider;
      state.provider = updates.cliProvider;
    }
    if (updates.cliModel !== undefined) {
      state.project.cliModel = typeof updates.cliModel === "string" && updates.cliModel.trim()
        ? updates.cliModel.trim()
        : null;
      state.model = state.project.cliModel ?? null;
    }
    if (updates.projectPrompt !== undefined) {
      state.project.projectPrompt = typeof updates.projectPrompt === "string" && updates.projectPrompt.trim()
        ? updates.projectPrompt.trim()
        : null;
    }

    this.emit("projects-changed", this.getProjects());
    this.emitSnapshot(projectId);
    this.requestSessionSync(projectId, {
      action: SessionSyncActions.UPDATE_PROJECT_CONFIG,
      limit: DEFAULT_PAGE_SIZE,
      projectUpdates: {
        groupName: state.project.groupName ?? null,
        cliProvider: state.project.cliProvider,
        cliModel: state.project.cliModel ?? null,
        projectPrompt: state.project.projectPrompt ?? null,
      },
    });
    return { success: true };
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
    if (state.project.online === false) {
      return { success: false, error: "Remote project is offline" };
    }
    if (!this.relayClient.isConnected()) {
      return { success: false, error: "Remote relay is disconnected" };
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
      const runObserverKey = this.getRunObserverKey(projectId, runId);
      this.runObservers.set(runObserverKey, {
        projectId,
        runId,
        streamId,
        startedAt: timestamp,
        lastActivityAt: timestamp,
        sawResponse: false,
        timeout: null,
        syncNudgeTimers: [],
        onTextDelta: options.onTextDelta,
        onDone: options.onDone,
        onError: options.onError,
      });
      this.scheduleRunObserverTimeout(runObserverKey);
      this.scheduleRunObserverSyncNudges(runObserverKey);
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
        projectPrompt: readString(item?.projectPrompt ?? item?.project_prompt).trim() || null,
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
        this.failProjectRunObservers(projectId, "Remote project is no longer available.");
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
    const runtimeChanged = this.applySessionRuntimeSnapshot(state, payload);

    const sync = (payload.sync ?? {}) as LooseRecord;
    const items = Array.isArray(sync?.items) ? sync.items as SyncItemPayload[] : [];
    const latestSeq = readNumber(sync.latest_seq ?? sync.latestSeq);
    let syncItemsChanged = false;
    for (const item of items) {
      syncItemsChanged = this.applySyncItem(state, item) || syncItemsChanged;
    }
    state.lastSyncSeq = Math.max(state.lastSyncSeq, latestSeq);
    this.resolvePendingHistoryRequests(projectId, readNumber(sync.before_seq ?? sync.beforeSeq));
    this.refreshProjectRunObservers(projectId);
    if (runtimeChanged || syncItemsChanged) {
      this.emitSnapshot(projectId);
    }
  }

  private applySessionRuntimeSnapshot(state: RemoteState, payload: LooseRecord): boolean {
    const nextSnapshotRevision = readString(payload.snapshot_revision ?? payload.snapshotRevision).trim() || null;
    if (nextSnapshotRevision && state.snapshotRevision === nextSnapshotRevision) {
      return false;
    }

    const nextProvider = readString(payload.provider) === "codex" ? "codex" : "claude";
    const nextModel = readString(payload.model).trim() || null;
    const nextIsRunning = Boolean(payload.isRunning ?? payload.is_running);
    const nextQueuedCount = readNumber(payload.queuedCount ?? payload.queued_count);
    const currentSource = readString(payload.currentSource ?? payload.current_source);
    const nextCurrentSource = currentSource === "remote" ? "remote" : (currentSource === "desktop" ? "desktop" : null);
    const nextCurrentPrompt = readString(payload.currentPrompt ?? payload.current_prompt) || null;
    const nextCurrentStartedAt = readNumber(payload.currentStartedAt ?? payload.current_started_at) || null;
    const nextActiveConversationId = readString(payload.active_conversation_id ?? payload.activeConversationId) || null;
    const nextQueue: QueuedRunSnapshot[] = Array.isArray(payload.queue)
      ? payload.queue.map((entry: any) => {
          const source = readString(entry.source) === "remote" ? "remote" : "desktop";
          return {
            runId: readString(entry.runId ?? entry.run_id).trim() || uuidv4(),
            prompt: readString(entry.prompt),
            source,
            queuedAt: readNumber(entry.queuedAt ?? entry.queued_at) || Date.now(),
            attachments: cloneAttachments(entry.attachments),
          };
        })
      : [];
    const nextConversations = Array.isArray(payload.conversations)
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
    const changed = (
      state.provider !== nextProvider
      || state.model !== nextModel
      || state.snapshotRevision !== nextSnapshotRevision
      || state.isRunning !== nextIsRunning
      || state.queuedCount !== nextQueuedCount
      || state.currentSource !== nextCurrentSource
      || state.currentPrompt !== nextCurrentPrompt
      || state.currentStartedAt !== nextCurrentStartedAt
      || state.activeConversationId !== nextActiveConversationId
      || !queueEntriesEqual(state.queue, nextQueue)
      || !conversationsEqual(state.conversations, nextConversations)
    );
    if (!changed) {
      return false;
    }

    state.provider = nextProvider;
    state.model = nextModel;
    state.snapshotRevision = nextSnapshotRevision;
    state.isRunning = nextIsRunning;
    state.queuedCount = nextQueuedCount;
    state.currentSource = nextCurrentSource;
    state.currentPrompt = nextCurrentPrompt;
    state.currentStartedAt = nextCurrentStartedAt;
    state.activeConversationId = nextActiveConversationId;
    state.queue = nextQueue;
    state.conversations = nextConversations;
    return true;
  }

  private handleAgentStatus(env: Envelope): void {
    const payload = env.payload as { project_id?: string; online?: boolean } | undefined;
    const projectId = payload?.project_id?.trim() || env.project_id?.trim() || "";
    const state = this.states.get(projectId);
    if (!state) {
      return;
    }
    state.project.online = Boolean(payload?.online);
    if (state.project.online === false) {
      this.failProjectRunObservers(projectId, "Remote project went offline.");
    }
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
    this.markRunObserverActivity(projectId, this.getRunIdFromStreamId(streamId), { sawResponse: true });

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
    this.clearRunObserverTimeout(runObserver);
    this.clearRunObserverSyncNudges(runObserver);
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

  private handleRelayError(env: Envelope): void {
    const payload = (env.payload ?? {}) as LooseRecord;
    const projectId = env.project_id?.trim() || readString(payload.project_id).trim();
    const streamId = env.stream_id?.trim() || readString(payload.stream_id).trim();
    const refId = readString(payload.ref_id).trim() || readString(env.id).trim();
    const errorText = readString(payload.message ?? payload.error).trim() || "Remote relay rejected the request.";
    const runId = streamId ? this.getRunIdFromStreamId(streamId) : refId;

    if (projectId && runId) {
      this.failRunObserver(projectId, runId, errorText, streamId || undefined);
    }
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

  private scheduleRunObserverTimeout(runObserverKey: string): void {
    const runObserver = this.runObservers.get(runObserverKey);
    if (!runObserver) {
      return;
    }

    this.clearRunObserverTimeout(runObserver);

    const state = this.states.get(runObserver.projectId);
    const now = Date.now();
    const hasQueuedRun = Boolean(state?.queue.some((entry) => entry.runId === runObserver.runId));
    const isActiveRemoteRun = Boolean(state?.isRunning && state.currentSource === "remote");
    const deadline = runObserver.sawResponse || hasQueuedRun || isActiveRemoteRun
      ? Math.min(runObserver.lastActivityAt + REMOTE_RUN_IDLE_TIMEOUT_MS, runObserver.startedAt + REMOTE_RUN_MAX_LIFETIME_MS)
      : runObserver.startedAt + REMOTE_RUN_START_TIMEOUT_MS;
    const delayMs = Math.max(1_000, deadline - now);

    runObserver.timeout = setTimeout(() => {
      this.handleRunObserverTimeout(runObserverKey);
    }, delayMs);
  }

  private handleRunObserverTimeout(runObserverKey: string): void {
    const runObserver = this.runObservers.get(runObserverKey);
    if (!runObserver) {
      return;
    }

    const state = this.states.get(runObserver.projectId);
    if (!state) {
      this.failRunObserver(runObserver.projectId, runObserver.runId, "Remote project is no longer available.", runObserver.streamId);
      return;
    }

    const assistantMessage = state.messages.find((entry) => entry.id === runObserver.streamId);
    if (assistantMessage?.status === "done") {
      this.clearRunObserverTimeout(runObserver);
      this.clearRunObserverSyncNudges(runObserver);
      this.runObservers.delete(runObserverKey);
      runObserver.onDone?.();
      return;
    }

    const now = Date.now();
    const elapsedMs = now - runObserver.startedAt;
    const idleMs = now - runObserver.lastActivityAt;
    const hasQueuedRun = state.queue.some((entry) => entry.runId === runObserver.runId);
    const isActiveRemoteRun = Boolean(state.isRunning && state.currentSource === "remote");

    if (!runObserver.sawResponse && !hasQueuedRun && !isActiveRemoteRun) {
      this.failRunObserver(
        runObserver.projectId,
        runObserver.runId,
        "Remote run did not start. Check that the remote desktop is online and authorized.",
        runObserver.streamId,
      );
      return;
    }

    if (elapsedMs >= REMOTE_RUN_MAX_LIFETIME_MS || idleMs >= REMOTE_RUN_IDLE_TIMEOUT_MS) {
      this.failRunObserver(
        runObserver.projectId,
        runObserver.runId,
        runObserver.sawResponse
          ? "Remote run timed out before completion."
          : "Remote run did not produce a response in time.",
        runObserver.streamId,
      );
      return;
    }

    this.scheduleRunObserverTimeout(runObserverKey);
  }

  private markRunObserverActivity(
    projectId: string,
    runId: string,
    options: { sawResponse?: boolean } = {},
  ): void {
    const runObserver = this.runObservers.get(this.getRunObserverKey(projectId, runId));
    if (!runObserver) {
      return;
    }
    runObserver.lastActivityAt = Date.now();
    if (options.sawResponse) {
      runObserver.sawResponse = true;
    }
    this.scheduleRunObserverTimeout(this.getRunObserverKey(projectId, runId));
  }

  private refreshProjectRunObservers(projectId: string): void {
    const state = this.states.get(projectId);
    if (!state) {
      return;
    }

    for (const [runObserverKey, runObserver] of this.runObservers.entries()) {
      if (runObserver.projectId !== projectId) {
        continue;
      }

      const assistantMessage = state.messages.find((entry) => entry.id === runObserver.streamId);
      if (assistantMessage?.status === "done") {
        this.clearRunObserverTimeout(runObserver);
        this.clearRunObserverSyncNudges(runObserver);
        this.runObservers.delete(runObserverKey);
        runObserver.onDone?.();
        continue;
      }

      const hasQueuedRun = state.queue.some((entry) => entry.runId === runObserver.runId);
      const isActiveRemoteRun = Boolean(state.isRunning && state.currentSource === "remote");
      if (hasQueuedRun || isActiveRemoteRun) {
        runObserver.lastActivityAt = Date.now();
      }
      this.scheduleRunObserverTimeout(runObserverKey);
    }
  }

  private failProjectRunObservers(projectId: string, errorText: string): void {
    for (const runObserver of Array.from(this.runObservers.values())) {
      if (runObserver.projectId !== projectId) {
        continue;
      }
      this.failRunObserver(projectId, runObserver.runId, errorText, runObserver.streamId);
    }
  }

  private failRunObserver(
    projectId: string,
    runId: string,
    errorText: string,
    streamIdOverride?: string,
  ): void {
    const runObserverKey = this.getRunObserverKey(projectId, runId);
    const runObserver = this.runObservers.get(runObserverKey);
    if (!runObserver) {
      return;
    }

    this.clearRunObserverTimeout(runObserver);
    this.clearRunObserverSyncNudges(runObserver);
    this.runObservers.delete(runObserverKey);

    const state = this.states.get(projectId);
    const streamId = streamIdOverride?.trim() || runObserver.streamId;
    if (state) {
      const assistantMessage = state.messages.find((entry) => entry.id === streamId);
      if (assistantMessage) {
        assistantMessage.status = "done";
        assistantMessage.updatedAt = Date.now();
      }

      const errorId = `${streamId}:error`;
      const existingError = state.messages.find((entry) => entry.id === errorId);
      if (existingError) {
        existingError.content = errorText;
        existingError.status = "done";
        existingError.updatedAt = Date.now();
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
        this.trimMessages(state);
      }
      this.emitSnapshot(projectId);
    }

    runObserver.onError?.(errorText);
  }

  private clearRunObserverTimeout(runObserver: RemoteRunObserver | undefined): void {
    if (!runObserver?.timeout) {
      return;
    }
    clearTimeout(runObserver.timeout);
    runObserver.timeout = null;
  }

  private scheduleRunObserverSyncNudges(runObserverKey: string): void {
    const runObserver = this.runObservers.get(runObserverKey);
    if (!runObserver) {
      return;
    }

    this.clearRunObserverSyncNudges(runObserver);
    for (const delayMs of [1_500, 5_000, 15_000]) {
      const timer = setTimeout(() => {
        const currentRunObserver = this.runObservers.get(runObserverKey);
        if (!currentRunObserver) {
          return;
        }
        if (currentRunObserver.sawResponse) {
          return;
        }
        this.requestSessionSync(currentRunObserver.projectId, {
          limit: DEFAULT_PAGE_SIZE,
        });
      }, delayMs);
      runObserver.syncNudgeTimers.push(timer);
    }
  }

  private clearRunObserverSyncNudges(runObserver: RemoteRunObserver | undefined): void {
    if (!runObserver || runObserver.syncNudgeTimers.length === 0) {
      return;
    }
    for (const timer of runObserver.syncNudgeTimers) {
      clearTimeout(timer);
    }
    runObserver.syncNudgeTimers = [];
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

  private applySyncItem(state: RemoteState, item: SyncItemPayload): boolean {
    const itemRecord = item as unknown as LooseRecord;
    const itemId = readString(item.id ?? itemRecord.id).trim();
    const itemKind = readString(item.kind ?? itemRecord.kind);
    const itemCreatedAt = readNumber(item.createdAt ?? itemRecord.created_at);
    const itemUpdatedAt = readNumber(item.updatedAt ?? itemRecord.updated_at);
    const itemSeq = readNumber(item.seq ?? itemRecord.seq);
    if (!item || !itemId) {
      return false;
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
        content: this.resolveRemoteContent(
          existingMessage?.content,
          readString(item.content ?? itemRecord.content),
          contentMd5,
          contentOmitted,
        ),
        attachments: attachmentsOmitted && existingMessage
          && createSessionSyncAttachmentsMd5(existingMessage.attachments) === attachmentsMd5
          ? cloneAttachments(existingMessage.attachments)
          : mergeAttachments(existingMessage?.attachments, item.attachments),
        source: item.role === "user" ? "desktop" : "remote",
        createdAt: itemCreatedAt,
        updatedAt: itemUpdatedAt,
        status: item.status === "streaming" ? "streaming" : "done",
        syncSeq: itemSeq,
      };
      const index = state.messages.findIndex((entry) => entry.id === itemId);
      const changed = !existingMessage || !this.messagesEqual(existingMessage, nextMessage);
      if (index >= 0) {
        state.messages[index] = nextMessage;
      } else {
        state.messages.push(nextMessage);
      }
      this.scheduleFullItemSyncIfNeeded(
        state,
        itemId,
        this.shouldRequestFullMessageItem({
          existingContent: existingMessage?.content,
          incomingContent: nextMessage.content,
          contentMd5,
          contentOmitted,
          existingAttachments: existingMessage?.attachments,
          attachmentsMd5,
          attachmentsOmitted,
        }),
      );
      this.trimMessages(state);
      return changed;
    }

    if (itemKind === "cli") {
      const existingEntry = state.cliTrace.find((entry) => entry.id === itemId);
      const contentMd5 = readString(item.content_md5 ?? itemRecord.content_md5).trim();
      const contentOmitted = Boolean(item.content_omitted ?? itemRecord.content_omitted);
      const nextEntry: RemoteCliEntry = {
        id: itemId,
        stream: item.cli_stream === "stderr" ? "stderr" : (item.cli_stream === "system" ? "system" : "stdout"),
        text: this.resolveRemoteContent(
          existingEntry?.text,
          readString(item.content ?? itemRecord.content),
          contentMd5,
          contentOmitted,
        ),
        createdAt: itemCreatedAt,
        syncSeq: itemSeq,
      };
      const index = state.cliTrace.findIndex((entry) => entry.id === itemId);
      const changed = !existingEntry || !this.cliEntriesEqual(existingEntry, nextEntry);
      if (index >= 0) {
        state.cliTrace[index] = nextEntry;
      } else {
        state.cliTrace.push(nextEntry);
      }
      this.scheduleFullItemSyncIfNeeded(
        state,
        itemId,
        this.shouldRequestFullContent(existingEntry?.text, nextEntry.text, contentMd5, contentOmitted),
      );
      this.trimCli(state);
      return changed;
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
      detail: this.resolveRemoteContent(
        existingActivity?.detail,
        readString(item.content ?? itemRecord.content),
        contentMd5,
        contentOmitted,
      ),
      status: this.mapActivityStatus(item.status),
      createdAt: itemCreatedAt,
      updatedAt: itemUpdatedAt,
      syncSeq: itemSeq,
    };
    const index = state.activities.findIndex((entry) => entry.id === itemId);
    const changed = !existingActivity || !this.activitiesEqual(existingActivity, nextActivity);
    if (index >= 0) {
      state.activities[index] = nextActivity;
    } else {
      state.activities.push(nextActivity);
    }
    this.scheduleFullItemSyncIfNeeded(
      state,
      itemId,
      this.shouldRequestFullContent(existingActivity?.detail, nextActivity.detail, contentMd5, contentOmitted),
    );
    this.trimActivities(state);
    return changed;
  }

  private messagesEqual(left: RemoteMessageEntry, right: RemoteMessageEntry): boolean {
    return left.id === right.id
      && left.role === right.role
      && left.content === right.content
      && left.source === right.source
      && left.createdAt === right.createdAt
      && left.updatedAt === right.updatedAt
      && left.status === right.status
      && left.syncSeq === right.syncSeq
      && attachmentsEqual(left.attachments, right.attachments);
  }

  private activitiesEqual(left: RemoteActivityEntry, right: RemoteActivityEntry): boolean {
    return left.id === right.id
      && left.kind === right.kind
      && left.title === right.title
      && left.detail === right.detail
      && left.status === right.status
      && left.createdAt === right.createdAt
      && left.updatedAt === right.updatedAt
      && left.syncSeq === right.syncSeq;
  }

  private cliEntriesEqual(left: RemoteCliEntry, right: RemoteCliEntry): boolean {
    return left.id === right.id
      && left.stream === right.stream
      && left.text === right.text
      && left.createdAt === right.createdAt
      && left.syncSeq === right.syncSeq;
  }

  private resolveRemoteContent(
    existingContent: string | undefined,
    incomingContent: string,
    contentMd5: string,
    contentOmitted: boolean,
  ): string {
    const normalizedExisting = typeof existingContent === "string" ? existingContent : "";
    if (
      normalizedExisting
      && contentMd5
      && createSessionSyncContentMd5(normalizedExisting) === contentMd5
    ) {
      return normalizedExisting;
    }
    if (contentOmitted) {
      return incomingContent;
    }
    return incomingContent;
  }

  private shouldRequestFullMessageItem(input: {
    existingContent: string | undefined;
    incomingContent: string;
    contentMd5: string;
    contentOmitted: boolean;
    existingAttachments: RunAttachment[] | undefined;
    attachmentsMd5: string;
    attachmentsOmitted: boolean;
  }): boolean {
    return this.shouldRequestFullContent(
      input.existingContent,
      input.incomingContent,
      input.contentMd5,
      input.contentOmitted,
    ) || this.shouldRequestFullAttachments(
      input.existingAttachments,
      input.attachmentsMd5,
      input.attachmentsOmitted,
    );
  }

  private shouldRequestFullContent(
    existingContent: string | undefined,
    incomingContent: string,
    contentMd5: string,
    contentOmitted: boolean,
  ): boolean {
    if (!contentOmitted) {
      return false;
    }
    if (contentMd5) {
      if (
        typeof existingContent === "string"
        && existingContent
        && createSessionSyncContentMd5(existingContent) === contentMd5
      ) {
        return false;
      }
      if (incomingContent && createSessionSyncContentMd5(incomingContent) === contentMd5) {
        return false;
      }
    }
    return true;
  }

  private shouldRequestFullAttachments(
    existingAttachments: RunAttachment[] | undefined,
    attachmentsMd5: string,
    attachmentsOmitted: boolean,
  ): boolean {
    if (!attachmentsOmitted) {
      return false;
    }
    if (
      attachmentsMd5
      && existingAttachments
      && createSessionSyncAttachmentsMd5(existingAttachments) === attachmentsMd5
    ) {
      return false;
    }
    return true;
  }

  private scheduleFullItemSyncIfNeeded(state: RemoteState, itemId: string, requiresFullContent: boolean): void {
    const requestKey = `${state.project.id}:${itemId}`;
    if (!requiresFullContent) {
      this.pendingFullItemRequests.delete(requestKey);
      return;
    }
    if (!this.relayClient.isConnected() || state.project.online === false) {
      return;
    }

    const now = Date.now();
    const previousRequestedAt = this.pendingFullItemRequests.get(requestKey) ?? 0;
    if (now - previousRequestedAt < FULL_ITEM_REQUEST_DEDUPE_MS) {
      return;
    }
    this.pendingFullItemRequests.set(requestKey, now);
    this.requestSessionSync(state.project.id, {
      action: SessionSyncActions.FETCH_ITEM_DETAIL,
      conversationId: state.activeConversationId,
      itemId,
      limit: 1,
    });
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
      snapshotRevision: null,
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
    if (state.activities.length > MAX_REMOTE_ACTIVITY_ITEMS) {
      state.activities.splice(0, state.activities.length - MAX_REMOTE_ACTIVITY_ITEMS);
    }
  }

  private trimCli(state: RemoteState): void {
    state.cliTrace.sort((left, right) => left.createdAt - right.createdAt || left.syncSeq - right.syncSeq);
    if (state.cliTrace.length > MAX_REMOTE_ITEMS) {
      state.cliTrace.splice(0, state.cliTrace.length - MAX_REMOTE_ITEMS);
    }
  }
}
