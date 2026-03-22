import { app } from "electron";
import Store from "electron-store";
import * as fs from "fs";
import * as path from "path";
import type {
  CliTraceEntry,
  RunAttachment,
  RunSource,
  SessionActivity,
  SessionMessage,
} from "./runtime-types";

export interface PersistedQueuedRun {
  runId: string;
  cwd: string;
  prompt: string;
  attachments?: RunAttachment[];
  source: RunSource;
  queuedAt: number;
}

export interface PersistedSessionMessage extends SessionMessage {
  syncSeq: number;
}

export interface PersistedSessionActivity extends SessionActivity {
  syncSeq: number;
}

export interface PersistedCliTraceEntry extends CliTraceEntry {
  syncSeq: number;
}

export interface PersistedConversationState {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  messages: PersistedSessionMessage[];
  activities: PersistedSessionActivity[];
  cliTrace: PersistedCliTraceEntry[];
  claudeSessionId: string | null;
  codexThreadId: string | null;
}

export interface PersistedProjectState {
  latestSeq: number;
  queue: PersistedQueuedRun[];
  activeConversationId: string | null;
  conversations: PersistedConversationState[];
}

export interface ProjectSyncChange {
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
  activityKind?: SessionActivity["kind"];
  cliStream?: CliTraceEntry["stream"];
}

export interface ProjectSyncDelta {
  latestSeq: number;
  items: ProjectSyncChange[];
  truncated: boolean;
}

export interface ProjectSyncRequest {
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
  conversationId?: string | null;
}

interface LegacyPersistedProjectState {
  queue?: PersistedQueuedRun[];
  messages?: SessionMessage[];
  activities?: SessionActivity[];
  claudeSessionId?: string | null;
  codexThreadId?: string | null;
  activeConversationId?: string | null;
  conversations?: LegacyConversationState[];
}

interface LegacyConversationState {
  id?: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  messages?: Array<SessionMessage | PersistedSessionMessage>;
  activities?: Array<SessionActivity | PersistedSessionActivity>;
  cliTrace?: Array<CliTraceEntry | PersistedCliTraceEntry>;
  claudeSessionId?: string | null;
  codexThreadId?: string | null;
}

interface LegacyRuntimeStoreSchema {
  sessionsByProjectId: Record<string, LegacyPersistedProjectState>;
}

const HISTORY_DIR_NAME = "runtime-history";
const MAX_SYNC_ITEMS = 200;

class SessionHistoryStore {
  private readonly historyDir: string;
  private readonly cache = new Map<string, PersistedProjectState>();
  private readonly writeTimers = new Map<string, NodeJS.Timeout>();

  constructor() {
    this.historyDir = path.join(app.getPath("userData"), HISTORY_DIR_NAME);
    fs.mkdirSync(this.historyDir, { recursive: true });
    this.migrateLegacyStore();
  }

  listProjectIds(): string[] {
    try {
      return fs.readdirSync(this.historyDir)
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => decodeURIComponent(entry.slice(0, -5)));
    } catch (_error) {
      return [];
    }
  }

  getAllProjects(): Array<{ projectId: string; state: PersistedProjectState }> {
    return this.listProjectIds().map((projectId) => ({
      projectId,
      state: this.getProjectState(projectId),
    }));
  }

  getLatestSeq(projectId: string): number {
    return this.getProjectState(projectId).latestSeq;
  }

  getProjectState(projectId: string): PersistedProjectState {
    const cached = this.cache.get(projectId);
    if (cached) {
      return cached;
    }

    const filePath = this.getProjectFilePath(projectId);
    if (!fs.existsSync(filePath)) {
      const empty = this.createEmptyState();
      this.cache.set(projectId, empty);
      return empty;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as LegacyPersistedProjectState;
      const normalized = this.normalizeProjectState(parsed);
      this.cache.set(projectId, normalized);
      return normalized;
    } catch (_error) {
      const empty = this.createEmptyState();
      this.cache.set(projectId, empty);
      return empty;
    }
  }

  updateProjectMeta(projectId: string, meta: {
    queue: PersistedQueuedRun[];
    activeConversationId: string | null;
    claudeSessionId: string | null;
    codexThreadId: string | null;
    conversationCreatedAt?: number | null;
    conversationUpdatedAt?: number | null;
  }): void {
    const state = this.getProjectState(projectId);
    state.queue = meta.queue.map((entry) => ({
      ...entry,
      attachments: this.cloneAttachments(entry.attachments),
    }));

    const activeConversation = this.ensureConversation(
      state,
      meta.activeConversationId,
      meta.conversationCreatedAt ?? undefined,
    );
    state.activeConversationId = activeConversation.id;
    activeConversation.claudeSessionId = meta.claudeSessionId;
    activeConversation.codexThreadId = meta.codexThreadId;
    activeConversation.updatedAt = meta.conversationUpdatedAt ?? Date.now();
    this.scheduleWrite(projectId);
  }

  upsertConversationMeta(projectId: string, meta: {
    conversationId: string;
    title?: string;
    createdAt?: number;
    updatedAt?: number;
    claudeSessionId?: string | null;
    codexThreadId?: string | null;
  }): void {
    const state = this.getProjectState(projectId);
    const conversation = this.ensureConversation(
      state,
      meta.conversationId,
      meta.createdAt ?? undefined,
    );
    conversation.title = meta.title ?? conversation.title ?? "";
    conversation.createdAt = meta.createdAt ?? conversation.createdAt;
    conversation.updatedAt = meta.updatedAt ?? conversation.updatedAt;
    if (meta.claudeSessionId !== undefined) {
      conversation.claudeSessionId = meta.claudeSessionId;
    }
    if (meta.codexThreadId !== undefined) {
      conversation.codexThreadId = meta.codexThreadId;
    }
    this.scheduleWrite(projectId);
  }

  upsertMessage(projectId: string, conversationId: string | null, message: SessionMessage): void {
    const state = this.getProjectState(projectId);
    const conversation = this.ensureConversation(state, conversationId);
    const existing = conversation.messages.find((entry) => entry.id === message.id);
    const nextSeq = existing?.syncSeq ?? this.nextSeq(state);
    const normalized: PersistedSessionMessage = {
      ...message,
      attachments: this.cloneAttachments(message.attachments),
      syncSeq: nextSeq,
    };
    if (existing) {
      Object.assign(existing, normalized);
    } else {
      conversation.messages.push(normalized);
      conversation.messages.sort((left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt);
    }
    conversation.updatedAt = Date.now();
    this.scheduleWrite(projectId);
  }

  upsertActivity(projectId: string, conversationId: string | null, activity: SessionActivity): void {
    const state = this.getProjectState(projectId);
    const conversation = this.ensureConversation(state, conversationId);
    const existing = conversation.activities.find((entry) => entry.id === activity.id);
    const nextSeq = existing?.syncSeq ?? this.nextSeq(state);
    const normalized: PersistedSessionActivity = {
      ...activity,
      meta: activity.meta ? { ...activity.meta } : undefined,
      syncSeq: nextSeq,
    };
    if (existing) {
      Object.assign(existing, normalized);
    } else {
      conversation.activities.push(normalized);
      conversation.activities.sort((left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt);
    }
    conversation.updatedAt = Date.now();
    this.scheduleWrite(projectId);
  }

  appendCliTrace(projectId: string, conversationId: string | null, entry: CliTraceEntry): void {
    const state = this.getProjectState(projectId);
    const conversation = this.ensureConversation(state, conversationId);
    const normalized: PersistedCliTraceEntry = {
      ...entry,
      syncSeq: this.nextSeq(state),
    };
    conversation.cliTrace.push(normalized);
    conversation.cliTrace.sort((left, right) => left.createdAt - right.createdAt || left.syncSeq - right.syncSeq);
    conversation.updatedAt = Date.now();
    this.scheduleWrite(projectId);
  }

  buildSyncDelta(projectId: string, request: number | ProjectSyncRequest = 0): ProjectSyncDelta {
    const state = this.getProjectState(projectId);
    const options = typeof request === "number"
      ? { afterSeq: request }
      : request;
    const conversation = this.resolveConversation(state, options.conversationId);
    if (!conversation) {
      return {
        latestSeq: state.latestSeq,
        items: [],
        truncated: false,
      };
    }

    const afterSeq = Number(options.afterSeq) > 0 ? Number(options.afterSeq) : 0;
    const beforeSeq = Number(options.beforeSeq) > 0 ? Number(options.beforeSeq) : 0;
    const limit = Number(options.limit) > 0 ? Math.max(1, Number(options.limit)) : MAX_SYNC_ITEMS;
    const changes: ProjectSyncChange[] = [];

    for (const message of conversation.messages) {
      changes.push({
        id: message.id,
        kind: "message",
        seq: message.syncSeq,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        role: message.role,
        content: message.content,
        attachments: this.cloneAttachments(message.attachments),
        status: message.status,
      });
    }

    for (const activity of conversation.activities) {
      changes.push({
        id: `activity:${activity.id}`,
        kind: activity.kind === "thinking" ? "thinking" : "activity",
        seq: activity.syncSeq,
        createdAt: activity.createdAt,
        updatedAt: activity.updatedAt,
        content: activity.detail,
        status: activity.status,
        title: activity.title,
        activityKind: activity.kind,
      });
    }

    for (const entry of conversation.cliTrace) {
      changes.push({
        id: `cli:${entry.id}`,
        kind: "cli",
        seq: entry.syncSeq,
        createdAt: entry.createdAt,
        updatedAt: entry.createdAt,
        content: entry.text,
        status: "done",
        cliStream: entry.stream,
      });
    }

    changes.sort((left, right) => left.seq - right.seq || left.createdAt - right.createdAt);

    let items = beforeSeq > 0
      ? changes.filter((entry) => entry.seq < beforeSeq)
      : (afterSeq > 0
        ? changes.filter((entry) => entry.seq > afterSeq)
        : changes);

    let truncated = false;
    if (items.length > limit) {
      items = items.slice(-limit);
      truncated = true;
    }

    return {
      latestSeq: state.latestSeq,
      items,
      truncated,
    };
  }

  clearProject(projectId: string): void {
    const timer = this.writeTimers.get(projectId);
    if (timer) {
      clearTimeout(timer);
      this.writeTimers.delete(projectId);
    }
    this.cache.delete(projectId);
    const filePath = this.getProjectFilePath(projectId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  flushAll(): void {
    for (const projectId of this.cache.keys()) {
      this.flushProject(projectId);
    }
  }

  private createEmptyState(): PersistedProjectState {
    return {
      latestSeq: 0,
      queue: [],
      activeConversationId: null,
      conversations: [],
    };
  }

  private createEmptyConversation(id: string, createdAt = Date.now()): PersistedConversationState {
    return {
      id,
      title: "",
      createdAt,
      updatedAt: createdAt,
      messages: [],
      activities: [],
      cliTrace: [],
      claudeSessionId: null,
      codexThreadId: null,
    };
  }

  private nextSeq(state: PersistedProjectState): number {
    state.latestSeq += 1;
    return state.latestSeq;
  }

  private getProjectFilePath(projectId: string): string {
    return path.join(this.historyDir, `${encodeURIComponent(projectId)}.json`);
  }

  private scheduleWrite(projectId: string): void {
    const existing = this.writeTimers.get(projectId);
    if (existing) {
      clearTimeout(existing);
    }
    this.writeTimers.set(projectId, setTimeout(() => {
      this.writeTimers.delete(projectId);
      this.flushProject(projectId);
    }, 180));
  }

  private flushProject(projectId: string): void {
    const state = this.cache.get(projectId);
    if (!state) {
      return;
    }

    fs.writeFileSync(
      this.getProjectFilePath(projectId),
      JSON.stringify(state),
      "utf8",
    );
  }

  private resolveConversation(
    state: PersistedProjectState,
    conversationId?: string | null,
  ): PersistedConversationState | null {
    const targetId = conversationId?.trim() || state.activeConversationId || state.conversations[0]?.id;
    if (!targetId) {
      return null;
    }
    return state.conversations.find((entry) => entry.id === targetId) ?? null;
  }

  private ensureConversation(
    state: PersistedProjectState,
    conversationId?: string | null,
    createdAt: number = Date.now(),
  ): PersistedConversationState {
    const targetId = conversationId?.trim() || state.activeConversationId || this.createConversationId();
    let conversation = state.conversations.find((entry) => entry.id === targetId);
    if (!conversation) {
      conversation = this.createEmptyConversation(targetId, createdAt);
      state.conversations.push(conversation);
      state.conversations.sort((left, right) => left.createdAt - right.createdAt);
    }
    state.activeConversationId = conversation.id;
    return conversation;
  }

  private normalizeProjectState(input: LegacyPersistedProjectState): PersistedProjectState {
    const state = this.createEmptyState();
    state.latestSeq = Math.max(0, Number((input as PersistedProjectState).latestSeq) || 0);
    state.queue = Array.isArray(input.queue)
      ? input.queue.map((entry) => ({
          ...entry,
          attachments: this.cloneAttachments(entry.attachments),
        }))
      : [];

    const hasConversationList = Array.isArray(input.conversations) && input.conversations.length > 0;
    if (hasConversationList) {
      state.conversations = input.conversations!.map((conversation, index) =>
        this.normalizeConversationState(
          conversation,
          conversation.id?.trim() || `conversation-${index + 1}`,
        ),
      );
      state.activeConversationId = input.activeConversationId?.trim() || state.conversations[0]?.id || null;
    } else if ((input.messages?.length ?? 0) > 0 || (input.activities?.length ?? 0) > 0) {
      const legacyConversation = this.normalizeConversationState({
        id: "conversation-1",
        createdAt: this.findEarliestTimestamp(input.messages ?? [], input.activities ?? []),
        updatedAt: this.findLatestTimestamp(input.messages ?? [], input.activities ?? []),
        messages: input.messages ?? [],
        activities: input.activities ?? [],
        cliTrace: [],
        claudeSessionId: input.claudeSessionId ?? null,
        codexThreadId: input.codexThreadId ?? null,
      }, "conversation-1");
      state.conversations = [legacyConversation];
      state.activeConversationId = legacyConversation.id;
    }

    if (state.conversations.length === 0 && input.activeConversationId) {
      const conversation = this.createEmptyConversation(input.activeConversationId.trim());
      state.conversations = [conversation];
      state.activeConversationId = conversation.id;
    }

    let maxSeq = state.latestSeq;
    for (const conversation of state.conversations) {
      conversation.messages = conversation.messages.map((message) => {
        const syncSeq = Number(message.syncSeq) > 0 ? Number(message.syncSeq) : ++maxSeq;
        maxSeq = Math.max(maxSeq, syncSeq);
        return {
          ...message,
          attachments: this.cloneAttachments(message.attachments),
          syncSeq,
        };
      });
      conversation.activities = conversation.activities.map((activity) => {
        const syncSeq = Number(activity.syncSeq) > 0 ? Number(activity.syncSeq) : ++maxSeq;
        maxSeq = Math.max(maxSeq, syncSeq);
        return {
          ...activity,
          meta: activity.meta ? { ...activity.meta } : undefined,
          syncSeq,
        };
      });
      conversation.cliTrace = conversation.cliTrace.map((entry) => {
        const syncSeq = Number(entry.syncSeq) > 0 ? Number(entry.syncSeq) : ++maxSeq;
        maxSeq = Math.max(maxSeq, syncSeq);
        return {
          ...entry,
          syncSeq,
        };
      });
      conversation.updatedAt = Math.max(
        conversation.updatedAt || conversation.createdAt,
        conversation.messages[conversation.messages.length - 1]?.updatedAt ?? 0,
        conversation.activities[conversation.activities.length - 1]?.updatedAt ?? 0,
        conversation.cliTrace[conversation.cliTrace.length - 1]?.createdAt ?? 0,
      );
    }
    state.latestSeq = maxSeq;

    if (!state.activeConversationId && state.conversations.length > 0) {
      state.activeConversationId = state.conversations[0].id;
    }

    return state;
  }

  private normalizeConversationState(
    input: LegacyConversationState | undefined,
    fallbackId: string,
  ): PersistedConversationState {
    const createdAt = Number(input?.createdAt) || Date.now();
    return {
      id: input?.id?.trim() || fallbackId,
      title: input?.title?.trim() || "",
      createdAt,
      updatedAt: Number(input?.updatedAt) || createdAt,
      messages: Array.isArray(input?.messages)
        ? input.messages.map((message: SessionMessage | PersistedSessionMessage) => ({
            ...(message as PersistedSessionMessage),
            attachments: this.cloneAttachments(message.attachments),
            syncSeq: Number((message as PersistedSessionMessage).syncSeq) || 0,
          }))
        : [],
      activities: Array.isArray(input?.activities)
        ? input.activities.map((activity: SessionActivity | PersistedSessionActivity) => ({
            ...(activity as PersistedSessionActivity),
            meta: activity.meta ? { ...activity.meta } : undefined,
            syncSeq: Number((activity as PersistedSessionActivity).syncSeq) || 0,
          }))
        : [],
      cliTrace: Array.isArray(input?.cliTrace)
        ? input.cliTrace.map((entry: CliTraceEntry | PersistedCliTraceEntry) => ({
            ...(entry as PersistedCliTraceEntry),
            syncSeq: Number((entry as PersistedCliTraceEntry).syncSeq) || 0,
          }))
        : [],
      claudeSessionId: input?.claudeSessionId ?? null,
      codexThreadId: input?.codexThreadId ?? null,
    };
  }

  private migrateLegacyStore(): void {
    const legacyStore = new Store<LegacyRuntimeStoreSchema>({
      name: "runtime-sessions",
      defaults: {
        sessionsByProjectId: {},
      },
    });

    const legacyProjects = legacyStore.get("sessionsByProjectId", {});
    for (const [projectId, legacyState] of Object.entries(legacyProjects)) {
      const filePath = this.getProjectFilePath(projectId);
      if (fs.existsSync(filePath)) {
        continue;
      }

      const migrated = this.normalizeProjectState(legacyState);
      this.cache.set(projectId, migrated);
      this.flushProject(projectId);
    }
  }

  private findEarliestTimestamp(messages: SessionMessage[], activities: SessionActivity[]): number {
    const all = [
      ...messages.map((item) => item.createdAt || item.updatedAt || Date.now()),
      ...activities.map((item) => item.createdAt || item.updatedAt || Date.now()),
    ].filter((value) => Number.isFinite(value) && value > 0);
    return all.length > 0 ? Math.min(...all) : Date.now();
  }

  private findLatestTimestamp(messages: SessionMessage[], activities: SessionActivity[]): number {
    const all = [
      ...messages.map((item) => item.updatedAt || item.createdAt || Date.now()),
      ...activities.map((item) => item.updatedAt || item.createdAt || Date.now()),
    ].filter((value) => Number.isFinite(value) && value > 0);
    return all.length > 0 ? Math.max(...all) : Date.now();
  }

  private createConversationId(): string {
    return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private cloneAttachments(attachments?: RunAttachment[]): RunAttachment[] | undefined {
    if (!attachments || attachments.length === 0) {
      return undefined;
    }

    return attachments.map((attachment) => ({ ...attachment }));
  }
}

export default SessionHistoryStore;
