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
  source?: SessionMessage["source"];
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
  itemId?: string | null;
}

export interface ChatHistoryRepairProjectResult {
  projectId: string;
  repaired: boolean;
  reset: boolean;
  backupPath: string | null;
  conversationCount: number;
  totalItems: number;
}

export interface ChatHistoryRepairSummary {
  scanned: number;
  repaired: number;
  reset: number;
  results: ChatHistoryRepairProjectResult[];
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
const MAX_PERSISTED_ACTIVITY_ENTRIES = 30;

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

  repairProjects(projectIds?: string[] | string | null): ChatHistoryRepairSummary {
    const normalizedProjectIds = Array.isArray(projectIds)
      ? projectIds.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
      : (typeof projectIds === "string" && projectIds.trim().length > 0 ? [projectIds.trim()] : []);
    const targetProjectIds = normalizedProjectIds.length > 0
      ? Array.from(new Set(normalizedProjectIds))
      : Array.from(new Set([
          ...this.listProjectIds(),
          ...this.cache.keys(),
        ])).sort((left, right) => left.localeCompare(right));

    const results = targetProjectIds.map((entry) => this.repairProject(entry));
    return {
      scanned: results.length,
      repaired: results.filter((entry) => entry.repaired).length,
      reset: results.filter((entry) => entry.reset).length,
      results,
    };
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
    const nextSeq = this.nextSeq(state);
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
    const nextSeq = this.nextSeq(state);
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
    this.trimActivities(conversation);
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
      if (!this.isProjectVisibleMessage(message)) {
        continue;
      }
      changes.push({
        id: message.id,
        kind: "message",
        seq: message.syncSeq,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        role: message.role,
        source: message.source,
        content: message.content,
        attachments: this.cloneAttachments(message.attachments),
        status: message.status,
      });
    }

    for (const activity of conversation.activities) {
      if (!this.isProjectVisibleActivity(activity)) {
        continue;
      }
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
        source: activity.meta?.source === "remote" || activity.meta?.source === "desktop" || activity.meta?.source === "workgroup"
          ? activity.meta.source
          : undefined,
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

    const requestedItemId = options.itemId?.trim() || "";
    if (requestedItemId) {
      const item = changes.find((entry) => entry.id === requestedItemId);
      return {
        latestSeq: state.latestSeq,
        items: item ? [item] : [],
        truncated: false,
      };
    }

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

  private isProjectVisibleMessage(message: PersistedSessionMessage): boolean {
    return message.source !== "workgroup";
  }

  private isProjectVisibleActivity(activity: PersistedSessionActivity): boolean {
    return activity.meta?.source !== "workgroup";
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

  private repairProject(projectId: string): ChatHistoryRepairProjectResult {
    const normalizedProjectId = projectId.trim();
    const filePath = this.getProjectFilePath(normalizedProjectId);
    const pendingWrite = this.writeTimers.get(normalizedProjectId);
    if (pendingWrite) {
      clearTimeout(pendingWrite);
      this.writeTimers.delete(normalizedProjectId);
    }

    let rawText = "";
    let reset = false;
    let backupPath: string | null = null;
    let parsedState: LegacyPersistedProjectState | PersistedProjectState | null = this.cache.get(normalizedProjectId) ?? null;

    if (fs.existsSync(filePath)) {
      rawText = fs.readFileSync(filePath, "utf8");
      try {
        parsedState = JSON.parse(rawText) as LegacyPersistedProjectState;
      } catch (_error) {
        backupPath = this.backupCorruptProjectFile(normalizedProjectId, filePath);
        parsedState = this.createEmptyState();
        reset = true;
      }
    }

    const normalized = this.normalizeProjectState(parsedState ?? this.createEmptyState());
    const nextPayload = JSON.stringify(normalized);
    const repaired = reset || !fs.existsSync(filePath) || rawText !== nextPayload;

    this.cache.set(normalizedProjectId, normalized);
    fs.writeFileSync(filePath, nextPayload, "utf8");

    return {
      projectId: normalizedProjectId,
      repaired,
      reset,
      backupPath,
      conversationCount: normalized.conversations.length,
      totalItems: this.countProjectItems(normalized),
    };
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
    state.queue = this.normalizeQueueEntries(input.queue);

    const hasConversationList = Array.isArray(input.conversations) && input.conversations.length > 0;
    if (hasConversationList) {
      const seenConversationIds = new Set<string>();
      state.conversations = input.conversations!
        .map((conversation, index) =>
          this.normalizeConversationState(
            conversation,
            this.ensureUniqueId(
              seenConversationIds,
              this.readString(conversation?.id) || `conversation-${index + 1}`,
              "conversation",
            ),
          ),
        );
      state.activeConversationId = this.readString(input.activeConversationId) || state.conversations[0]?.id || null;
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
      const conversation = this.createEmptyConversation(this.readString(input.activeConversationId) || "conversation-1");
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
    if (state.activeConversationId && !state.conversations.some((entry) => entry.id === state.activeConversationId)) {
      state.activeConversationId = state.conversations[0]?.id ?? null;
    }

    return state;
  }

  private normalizeConversationState(
    input: LegacyConversationState | undefined,
    fallbackId: string,
  ): PersistedConversationState {
    const createdAt = this.normalizeTimestamp(input?.createdAt, Date.now());
    const seenMessageIds = new Set<string>();
    const seenActivityIds = new Set<string>();
    const seenCliIds = new Set<string>();
    const messages = Array.isArray(input?.messages)
      ? input.messages
        .map((message, index) => this.normalizeMessageEntry(message as SessionMessage | PersistedSessionMessage, index, createdAt, seenMessageIds))
        .filter((message): message is PersistedSessionMessage => message !== null)
        .sort((left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt || left.syncSeq - right.syncSeq)
      : [];
    const activities = Array.isArray(input?.activities)
      ? input.activities
        .map((activity, index) => this.normalizeActivityEntry(activity as SessionActivity | PersistedSessionActivity, index, createdAt, seenActivityIds))
        .filter((activity): activity is PersistedSessionActivity => activity !== null)
        .sort((left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt || left.syncSeq - right.syncSeq)
        .slice(-MAX_PERSISTED_ACTIVITY_ENTRIES)
      : [];
    const cliTrace = Array.isArray(input?.cliTrace)
      ? input.cliTrace
        .map((entry, index) => this.normalizeCliTraceEntry(entry as CliTraceEntry | PersistedCliTraceEntry, index, createdAt, seenCliIds))
        .filter((entry): entry is PersistedCliTraceEntry => entry !== null)
        .sort((left, right) => left.createdAt - right.createdAt || left.syncSeq - right.syncSeq)
      : [];

    return {
      id: this.readString(input?.id) || fallbackId,
      title: this.readString(input?.title) || "",
      createdAt,
      updatedAt: this.normalizeTimestamp(input?.updatedAt, createdAt),
      messages,
      activities,
      cliTrace,
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

  private normalizeQueueEntries(input: unknown): PersistedQueuedRun[] {
    if (!Array.isArray(input)) {
      return [];
    }

    const normalized: PersistedQueuedRun[] = input
      .map((entry, index) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const queueEntry = entry as Partial<PersistedQueuedRun>;
        const runId = this.readString(queueEntry.runId) || `queued-${index + 1}`;
        const prompt = this.readString(queueEntry.prompt);
        if (!prompt) {
          return null;
        }
        return {
          runId,
          cwd: this.readString(queueEntry.cwd) || "",
          prompt,
          attachments: this.normalizeAttachments(queueEntry.attachments),
          source: queueEntry.source === "remote"
            ? "remote"
            : (queueEntry.source === "workgroup" ? "workgroup" : "desktop"),
          queuedAt: this.normalizeTimestamp(queueEntry.queuedAt, Date.now()),
        } as PersistedQueuedRun;
      })
      .filter((entry): entry is PersistedQueuedRun => entry !== null);
    normalized.sort((left, right) => left.queuedAt - right.queuedAt || left.runId.localeCompare(right.runId));
    return normalized;
  }

  private normalizeMessageEntry(
    input: SessionMessage | PersistedSessionMessage,
    index: number,
    fallbackTimestamp: number,
    seenIds: Set<string>,
  ): PersistedSessionMessage | null {
    if (!input || typeof input !== "object") {
      return null;
    }
    const id = this.ensureUniqueId(seenIds, this.readString((input as PersistedSessionMessage).id) || `message-${index + 1}`, "message");
    const createdAt = this.normalizeTimestamp((input as PersistedSessionMessage).createdAt, fallbackTimestamp);
    const updatedAt = this.normalizeTimestamp((input as PersistedSessionMessage).updatedAt, createdAt);
    return {
      ...(input as PersistedSessionMessage),
      id,
      role: this.normalizeMessageRole((input as PersistedSessionMessage).role),
      content: String((input as PersistedSessionMessage).content ?? ""),
      attachments: this.normalizeAttachments((input as PersistedSessionMessage).attachments),
      provider: (input as PersistedSessionMessage).provider === "codex" ? "codex" : ((input as PersistedSessionMessage).provider === "claude" ? "claude" : null),
      source: (input as PersistedSessionMessage).source === "remote"
        ? "remote"
        : ((input as PersistedSessionMessage).source === "workgroup" ? "workgroup" : "desktop"),
      createdAt,
      updatedAt: Math.max(updatedAt, createdAt),
      status: (input as PersistedSessionMessage).status === "streaming" ? "streaming" : "done",
      syncSeq: Math.max(0, Number((input as PersistedSessionMessage).syncSeq) || 0),
    };
  }

  private normalizeActivityEntry(
    input: SessionActivity | PersistedSessionActivity,
    index: number,
    fallbackTimestamp: number,
    seenIds: Set<string>,
  ): PersistedSessionActivity | null {
    if (!input || typeof input !== "object") {
      return null;
    }
    const id = this.ensureUniqueId(seenIds, this.readString((input as PersistedSessionActivity).id) || `activity-${index + 1}`, "activity");
    const createdAt = this.normalizeTimestamp((input as PersistedSessionActivity).createdAt, fallbackTimestamp);
    const updatedAt = this.normalizeTimestamp((input as PersistedSessionActivity).updatedAt, createdAt);
    return {
      ...(input as PersistedSessionActivity),
      id,
      kind: this.normalizeActivityKind((input as PersistedSessionActivity).kind),
      title: this.readString((input as PersistedSessionActivity).title) || "Activity",
      detail: String((input as PersistedSessionActivity).detail ?? ""),
      status: this.normalizeActivityStatus((input as PersistedSessionActivity).status),
      createdAt,
      updatedAt: Math.max(updatedAt, createdAt),
      meta: this.normalizeMeta((input as PersistedSessionActivity).meta),
      syncSeq: Math.max(0, Number((input as PersistedSessionActivity).syncSeq) || 0),
    };
  }

  private normalizeCliTraceEntry(
    input: CliTraceEntry | PersistedCliTraceEntry,
    index: number,
    fallbackTimestamp: number,
    seenIds: Set<string>,
  ): PersistedCliTraceEntry | null {
    if (!input || typeof input !== "object") {
      return null;
    }
    const id = this.ensureUniqueId(seenIds, this.readString((input as PersistedCliTraceEntry).id) || `cli-${index + 1}`, "cli");
    return {
      ...(input as PersistedCliTraceEntry),
      id,
      stream: this.normalizeCliStream((input as PersistedCliTraceEntry).stream),
      text: String((input as PersistedCliTraceEntry).text ?? ""),
      createdAt: this.normalizeTimestamp((input as PersistedCliTraceEntry).createdAt, fallbackTimestamp),
      syncSeq: Math.max(0, Number((input as PersistedCliTraceEntry).syncSeq) || 0),
    };
  }

  private normalizeAttachments(attachments?: RunAttachment[]): RunAttachment[] | undefined {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return undefined;
    }

    const normalized: RunAttachment[] = attachments
      .map((attachment, index) => {
        if (!attachment || typeof attachment !== "object") {
          return null;
        }
        const name = this.readString(attachment.name) || `attachment-${index + 1}`;
        const attachmentPath = this.readString(attachment.path) || "";
        return {
          id: this.readString(attachment.id) || `attachment-${index + 1}`,
          name,
          path: attachmentPath,
          size: Math.max(0, Number(attachment.size) || 0),
          kind: attachment.kind === "image" ? "image" : "file",
          mimeType: this.readString(attachment.mimeType) || undefined,
          previewDataUrl: this.readString(attachment.previewDataUrl) || undefined,
        } as RunAttachment;
      })
      .filter((attachment): attachment is RunAttachment => attachment !== null);

    return normalized.length > 0 ? normalized : undefined;
  }

  private normalizeMeta(meta: SessionActivity["meta"]): SessionActivity["meta"] {
    if (!meta || typeof meta !== "object") {
      return undefined;
    }
    const normalizedEntries = Object.entries(meta)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => [key, value] as const);
    return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : undefined;
  }

  private normalizeTimestamp(value: unknown, fallback: number): number {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
  }

  private normalizeMessageRole(role: unknown): SessionMessage["role"] {
    return role === "user" || role === "assistant" || role === "error" ? role : "assistant";
  }

  private normalizeActivityKind(kind: unknown): SessionActivity["kind"] {
    switch (kind) {
      case "status":
      case "thinking":
      case "tool":
      case "command":
      case "agent":
      case "error":
        return kind;
      default:
        return "status";
    }
  }

  private normalizeActivityStatus(status: unknown): SessionActivity["status"] {
    switch (status) {
      case "pending":
      case "running":
      case "completed":
      case "error":
        return status;
      default:
        return "completed";
    }
  }

  private normalizeCliStream(stream: unknown): CliTraceEntry["stream"] {
    switch (stream) {
      case "system":
      case "stderr":
      case "stdout":
        return stream;
      default:
        return "stdout";
    }
  }

  private ensureUniqueId(seenIds: Set<string>, candidate: string, prefix: string): string {
    let normalized = candidate.trim() || `${prefix}-${Date.now()}`;
    if (!seenIds.has(normalized)) {
      seenIds.add(normalized);
      return normalized;
    }
    let suffix = 2;
    while (seenIds.has(`${normalized}-${suffix}`)) {
      suffix += 1;
    }
    normalized = `${normalized}-${suffix}`;
    seenIds.add(normalized);
    return normalized;
  }

  private readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private backupCorruptProjectFile(projectId: string, filePath: string): string {
    const backupPath = path.join(this.historyDir, `${encodeURIComponent(projectId)}.corrupt-${Date.now()}.json`);
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }

  private countProjectItems(state: PersistedProjectState): number {
    return state.conversations.reduce(
      (total, conversation) => total + conversation.messages.length + conversation.activities.length + conversation.cliTrace.length,
      0,
    );
  }

  private trimActivities(conversation: PersistedConversationState): void {
    if (conversation.activities.length > MAX_PERSISTED_ACTIVITY_ENTRIES) {
      conversation.activities.splice(0, conversation.activities.length - MAX_PERSISTED_ACTIVITY_ENTRIES);
    }
  }
}

export default SessionHistoryStore;
