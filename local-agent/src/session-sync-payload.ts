import type { ProjectSyncDelta } from "./session-history-store";
import type {
  ProjectSessionSnapshot,
  RunAttachment,
  SessionMessage,
} from "./runtime-types";

const MAX_SYNC_PAYLOAD_BYTES = 240 * 1024;
const MAX_SYNC_ITEMS = 200;
const MAX_SYNC_TEXT_CHARS = 2_400;
const MAX_SYNC_PROMPT_CHARS = 320;

export interface SessionSyncQueuePayload {
  runId: string;
  prompt: string;
  source: "remote" | "desktop";
  queuedAt: number;
}

export interface SessionSyncItemPayload {
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

export interface SessionSyncPayload {
  sync_version: 2;
  project_id: string;
  provider: ProjectSessionSnapshot["provider"];
  model: string | null;
  isRunning: boolean;
  queuedCount: number;
  currentSource: ProjectSessionSnapshot["currentSource"];
  currentPrompt: string | null;
  currentStartedAt: number | null;
  queue: SessionSyncQueuePayload[];
  sync: {
    after_seq: number;
    latest_seq: number;
    truncated: boolean;
    items: SessionSyncItemPayload[];
  };
}

function trimText(text: string | null | undefined, maxChars: number): string {
  const normalized = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 24)}\n... earlier text omitted`;
}

function cloneAttachments(attachments?: RunAttachment[]): RunAttachment[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }

  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    path: attachment.path,
    size: attachment.size,
    kind: attachment.kind,
  }));
}

function payloadByteLength(payload: SessionSyncPayload): number {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function buildQueuePayload(snapshot: ProjectSessionSnapshot): SessionSyncQueuePayload[] {
  return snapshot.queue
    .slice(0, 8)
    .map((entry) => ({
      runId: entry.runId,
      prompt: trimText(entry.prompt, MAX_SYNC_PROMPT_CHARS),
      source: entry.source,
      queuedAt: entry.queuedAt,
    }));
}

function normalizeItems(delta: ProjectSyncDelta): SessionSyncItemPayload[] {
  return delta.items
    .slice(-MAX_SYNC_ITEMS)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      seq: item.seq,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      role: item.role,
      content: trimText(item.content, MAX_SYNC_TEXT_CHARS),
      attachments: cloneAttachments(item.attachments),
      status: item.status,
    }));
}

export function buildSessionSyncPayload(
  snapshot: ProjectSessionSnapshot,
  delta: ProjectSyncDelta,
  afterSeq: number,
): SessionSyncPayload {
  let payload: SessionSyncPayload = {
    sync_version: 2,
    project_id: snapshot.projectId,
    provider: snapshot.provider,
    model: snapshot.model,
    isRunning: snapshot.isRunning,
    queuedCount: snapshot.queuedCount,
    currentSource: snapshot.currentSource,
    currentPrompt: snapshot.currentPrompt ? trimText(snapshot.currentPrompt, MAX_SYNC_PROMPT_CHARS) : null,
    currentStartedAt: snapshot.currentStartedAt,
    queue: buildQueuePayload(snapshot),
    sync: {
      after_seq: afterSeq,
      latest_seq: delta.latestSeq,
      truncated: delta.truncated,
      items: normalizeItems(delta),
    },
  };

  while (payloadByteLength(payload) > MAX_SYNC_PAYLOAD_BYTES && payload.sync.items.length > 0) {
    payload = {
      ...payload,
      sync: {
        ...payload.sync,
        items: payload.sync.items.slice(1).map((item) => ({
          ...item,
          content: trimText(item.content, 1_200),
        })),
      },
    };
  }

  return payload;
}
