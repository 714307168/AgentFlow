import type { ProjectSyncDelta } from "./session-history-store";
import {
  createSessionSyncContentMd5,
  createSessionSyncAttachmentsMd5,
  type SessionSyncKnownItemDigest,
} from "./session-sync-hash";
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
  kind: "message" | "thinking" | "activity" | "cli";
  seq: number;
  createdAt: number;
  updatedAt: number;
  role?: SessionMessage["role"];
  content: string;
  content_md5: string;
  content_omitted?: boolean;
  attachments?: RunAttachment[];
  attachments_md5?: string | null;
  attachments_omitted?: boolean;
  status: string;
  title?: string;
  activity_kind?: string;
  cli_stream?: "system" | "stdout" | "stderr";
}

export interface SessionConversationPayload {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  is_active: boolean;
  message_count: number;
  activity_count: number;
  cli_count: number;
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
  active_conversation_id: string | null;
  conversations: SessionConversationPayload[];
  queue: SessionSyncQueuePayload[];
  sync: {
    after_seq: number;
    before_seq: number | null;
    limit: number | null;
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
    mimeType: attachment.mimeType,
    previewDataUrl: attachment.previewDataUrl,
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

function buildKnownItemMap(knownItems?: SessionSyncKnownItemDigest[]): Map<string, SessionSyncKnownItemDigest> {
  const map = new Map<string, SessionSyncKnownItemDigest>();
  for (const item of knownItems ?? []) {
    const id = String(item?.id ?? "").trim();
    if (!id) {
      continue;
    }
    map.set(id, {
      id,
      content_md5: typeof item.content_md5 === "string" ? item.content_md5.trim() : undefined,
      attachments_md5: typeof item.attachments_md5 === "string" ? item.attachments_md5.trim() : undefined,
    });
  }
  return map;
}

function normalizeItems(delta: ProjectSyncDelta, knownItems?: SessionSyncKnownItemDigest[]): SessionSyncItemPayload[] {
  const knownItemMap = buildKnownItemMap(knownItems);
  return delta.items
    .slice(-MAX_SYNC_ITEMS)
    .map((item) => {
      const trimmedContent = trimText(item.content, MAX_SYNC_TEXT_CHARS);
      const contentMd5 = createSessionSyncContentMd5(trimmedContent);
      const attachments = cloneAttachments(item.attachments);
      const attachmentsMd5 = createSessionSyncAttachmentsMd5(attachments);
      const known = knownItemMap.get(item.id);
      const shouldOmitContent = Boolean(known?.content_md5) && known?.content_md5 === contentMd5;
      const shouldOmitAttachments = Boolean(attachmentsMd5) && known?.attachments_md5 === attachmentsMd5;

      return {
        id: item.id,
        kind: item.kind,
        seq: item.seq,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        role: item.role,
        content: shouldOmitContent ? "" : trimmedContent,
        content_md5: contentMd5,
        content_omitted: shouldOmitContent || undefined,
        attachments: shouldOmitAttachments ? undefined : attachments,
        attachments_md5: attachmentsMd5 ?? undefined,
        attachments_omitted: shouldOmitAttachments || undefined,
        status: item.status,
        title: item.title ? trimText(item.title, 240) : undefined,
        activity_kind: item.activityKind,
        cli_stream: item.cliStream,
      };
    });
}

function buildConversationPayload(snapshot: ProjectSessionSnapshot): SessionConversationPayload[] {
  return snapshot.conversations.map((conversation) => ({
    id: conversation.id,
    title: trimText(conversation.title, 72),
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
    is_active: conversation.isActive,
    message_count: conversation.messageCount,
    activity_count: conversation.activityCount,
    cli_count: conversation.cliCount,
  }));
}

export function buildSessionSyncPayload(
  snapshot: ProjectSessionSnapshot,
  delta: ProjectSyncDelta,
  request: {
    afterSeq?: number;
    beforeSeq?: number;
    limit?: number;
    knownItems?: SessionSyncKnownItemDigest[];
  } = {},
): SessionSyncPayload {
  const afterSeq = Number(request.afterSeq) > 0 ? Number(request.afterSeq) : 0;
  const beforeSeq = Number(request.beforeSeq) > 0 ? Number(request.beforeSeq) : null;
  const limit = Number(request.limit) > 0 ? Number(request.limit) : null;
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
    active_conversation_id: snapshot.activeConversationId,
    conversations: buildConversationPayload(snapshot),
    queue: buildQueuePayload(snapshot),
    sync: {
      after_seq: afterSeq,
      before_seq: beforeSeq,
      limit,
      latest_seq: delta.latestSeq,
      truncated: delta.truncated,
      items: normalizeItems(delta, request.knownItems),
    },
  };

  while (payloadByteLength(payload) > MAX_SYNC_PAYLOAD_BYTES && payload.sync.items.length > 0) {
    payload = {
      ...payload,
      sync: {
        ...payload.sync,
        truncated: true,
        items: payload.sync.items.slice(1).map((item) => ({
          ...item,
          content: item.content_omitted ? item.content : trimText(item.content, 1_200),
          content_md5: item.content_omitted ? item.content_md5 : createSessionSyncContentMd5(trimText(item.content, 1_200)),
        })),
      },
    };
  }

  return payload;
}
