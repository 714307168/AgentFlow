import { app } from "electron";
import Store from "electron-store";
import * as fs from "fs";
import * as path from "path";
import type {
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

export interface PersistedProjectState {
  latestSeq: number;
  queue: PersistedQueuedRun[];
  messages: PersistedSessionMessage[];
  activities: PersistedSessionActivity[];
  claudeSessionId: string | null;
  codexThreadId: string | null;
}

export interface ProjectSyncChange {
  id: string;
  kind: "message" | "thinking";
  seq: number;
  createdAt: number;
  updatedAt: number;
  role?: SessionMessage["role"];
  content: string;
  attachments?: RunAttachment[];
  status: string;
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
}

interface LegacyPersistedProjectState {
  queue?: PersistedQueuedRun[];
  messages?: SessionMessage[];
  activities?: SessionActivity[];
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
    return this.listProjectIds()
      .map((projectId) => ({
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
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as PersistedProjectState;
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
    claudeSessionId: string | null;
    codexThreadId: string | null;
  }): void {
    const state = this.getProjectState(projectId);
    state.queue = meta.queue.map((entry) => ({
      ...entry,
      attachments: this.cloneAttachments(entry.attachments),
    }));
    state.claudeSessionId = meta.claudeSessionId;
    state.codexThreadId = meta.codexThreadId;
    this.scheduleWrite(projectId);
  }

  upsertMessage(projectId: string, message: SessionMessage): void {
    const state = this.getProjectState(projectId);
    const existing = state.messages.find((entry) => entry.id === message.id);
    const nextSeq = this.nextSeq(state);
    const normalized: PersistedSessionMessage = {
      ...message,
      attachments: this.cloneAttachments(message.attachments),
      syncSeq: nextSeq,
    };
    if (existing) {
      Object.assign(existing, normalized);
    } else {
      state.messages.push(normalized);
      state.messages.sort((left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt);
    }
    this.scheduleWrite(projectId);
  }

  upsertActivity(projectId: string, activity: SessionActivity): void {
    const state = this.getProjectState(projectId);
    const existing = state.activities.find((entry) => entry.id === activity.id);
    const nextSeq = this.nextSeq(state);
    const normalized: PersistedSessionActivity = {
      ...activity,
      meta: activity.meta ? { ...activity.meta } : undefined,
      syncSeq: nextSeq,
    };
    if (existing) {
      Object.assign(existing, normalized);
    } else {
      state.activities.push(normalized);
      state.activities.sort((left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt);
    }
    this.scheduleWrite(projectId);
  }

  buildSyncDelta(projectId: string, request: number | ProjectSyncRequest = 0): ProjectSyncDelta {
    const state = this.getProjectState(projectId);
    const options = typeof request === "number"
      ? { afterSeq: request }
      : request;
    const afterSeq = Number(options.afterSeq) > 0 ? Number(options.afterSeq) : 0;
    const beforeSeq = Number(options.beforeSeq) > 0 ? Number(options.beforeSeq) : 0;
    const limit = Number(options.limit) > 0 ? Math.max(1, Number(options.limit)) : MAX_SYNC_ITEMS;
    const changes: ProjectSyncChange[] = [];

    for (const message of state.messages) {
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

    for (const activity of state.activities) {
      if (activity.kind !== "thinking") {
        continue;
      }
      changes.push({
        id: `thinking:${activity.id}`,
        kind: "thinking",
        seq: activity.syncSeq,
        createdAt: activity.createdAt,
        updatedAt: activity.updatedAt,
        content: activity.detail,
        status: activity.status,
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
      messages: [],
      activities: [],
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

  private normalizeProjectState(input: PersistedProjectState): PersistedProjectState {
    const state = this.createEmptyState();
    state.latestSeq = Math.max(0, Number(input.latestSeq) || 0);
    state.queue = Array.isArray(input.queue)
      ? input.queue.map((entry) => ({
          ...entry,
          attachments: this.cloneAttachments(entry.attachments),
        }))
      : [];
    state.messages = Array.isArray(input.messages)
      ? input.messages.map((message) => ({
          ...message,
          attachments: this.cloneAttachments(message.attachments),
          syncSeq: Number(message.syncSeq) || 0,
        }))
      : [];
    state.activities = Array.isArray(input.activities)
      ? input.activities.map((activity) => ({
          ...activity,
          meta: activity.meta ? { ...activity.meta } : undefined,
          syncSeq: Number(activity.syncSeq) || 0,
        }))
      : [];
    state.claudeSessionId = input.claudeSessionId ?? null;
    state.codexThreadId = input.codexThreadId ?? null;

    let maxSeq = state.latestSeq;
    for (const message of state.messages) {
      if (message.syncSeq <= 0) {
        maxSeq += 1;
        message.syncSeq = maxSeq;
      } else {
        maxSeq = Math.max(maxSeq, message.syncSeq);
      }
    }
    for (const activity of state.activities) {
      if (activity.syncSeq <= 0) {
        maxSeq += 1;
        activity.syncSeq = maxSeq;
      } else {
        maxSeq = Math.max(maxSeq, activity.syncSeq);
      }
    }
    state.latestSeq = maxSeq;

    return state;
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

      const migrated = this.migrateLegacyProject(legacyState);
      this.cache.set(projectId, migrated);
      this.flushProject(projectId);
    }
  }

  private migrateLegacyProject(legacyState: LegacyPersistedProjectState): PersistedProjectState {
    const migrated = this.createEmptyState();
    migrated.queue = Array.isArray(legacyState.queue)
      ? legacyState.queue.map((entry) => ({
          ...entry,
          attachments: this.cloneAttachments(entry.attachments),
        }))
      : [];
    migrated.claudeSessionId = legacyState.claudeSessionId ?? null;
    migrated.codexThreadId = legacyState.codexThreadId ?? null;

    const timeline = [
      ...((legacyState.messages ?? []).map((message, index) => ({
        kind: "message" as const,
        index,
        createdAt: message.updatedAt || message.createdAt || 0,
        entry: message,
      }))),
      ...((legacyState.activities ?? []).map((activity, index) => ({
        kind: "activity" as const,
        index,
        createdAt: activity.updatedAt || activity.createdAt || 0,
        entry: activity,
      }))),
    ].sort((left, right) => left.createdAt - right.createdAt || left.index - right.index);

    for (const item of timeline) {
      if (item.kind === "message") {
        migrated.latestSeq += 1;
        migrated.messages.push({
          ...item.entry,
          attachments: this.cloneAttachments(item.entry.attachments),
          syncSeq: migrated.latestSeq,
        });
      } else {
        migrated.latestSeq += 1;
        migrated.activities.push({
          ...item.entry,
          meta: item.entry.meta ? { ...item.entry.meta } : undefined,
          syncSeq: migrated.latestSeq,
        });
      }
    }

    return migrated;
  }

  private cloneAttachments(attachments?: RunAttachment[]): RunAttachment[] | undefined {
    if (!attachments || attachments.length === 0) {
      return undefined;
    }

    return attachments.map((attachment) => ({ ...attachment }));
  }
}

export default SessionHistoryStore;
