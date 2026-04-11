import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import RelayClient from "./relay-client";
import { createSessionSyncContentMd5 } from "./session-sync-hash";
import { Envelope, Events } from "./types";
import type {
  WorkgroupCollaborationMemberSnapshot,
  WorkgroupCollaborationSessionSnapshot,
  WorkgroupCollaborationSummary,
} from "./workgroup-collaboration-service";
import type { WorkgroupCollaborationMessage } from "./workgroup-collaboration-store";

export interface RemoteWorkgroupRegistryRecord {
  groupNumber: string;
  workgroupId: string;
  hostAgentId: string;
  name: string;
  description?: string | null;
  ownerUsername?: string | null;
  memberCount?: number;
  canManage?: boolean;
  joined?: boolean;
  updatedAt: number;
}

interface RemoteWorkgroupSessionState {
  compositeId: string;
  hostAgentId: string;
  sourceWorkgroupId: string;
  session: WorkgroupCollaborationSessionSnapshot;
}

type PendingSessionRequest = {
  compositeId: string;
  resolve: (value: { success: boolean; session?: WorkgroupCollaborationSessionSnapshot; error?: string }) => void;
  timeout: NodeJS.Timeout;
};

type PendingSendRequest = {
  compositeId: string;
  resolve: (value: { success: boolean; session?: WorkgroupCollaborationSessionSnapshot; error?: string }) => void;
  timeout: NodeJS.Timeout;
};

const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_PAGE_SIZE = 30;
const KNOWN_ITEM_LIMIT = 60;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = normalizeText(value);
  return normalized || null;
}

function normalizeRole(value: unknown): WorkgroupCollaborationMemberSnapshot["role"] {
  const normalized = normalizeText(value);
  if (normalized === "developer" || normalized === "qa" || normalized === "project_manager" || normalized === "custom") {
    return normalized;
  }
  return "custom";
}

function normalizeNullableRole(value: unknown): WorkgroupCollaborationMessage["memberRole"] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  return normalizeRole(normalized);
}

function normalizeSenderType(value: unknown): WorkgroupCollaborationMessage["senderType"] {
  const normalized = normalizeText(value);
  if (normalized === "user" || normalized === "member" || normalized === "system" || normalized === "error") {
    return normalized;
  }
  return "member";
}

export function buildCompositeWorkgroupId(hostAgentId: string, workgroupId: string): string {
  return `remote:${hostAgentId.trim()}:${workgroupId.trim()}`;
}

export function parseCompositeWorkgroupId(compositeId: string): { hostAgentId: string; workgroupId: string } | null {
  const normalized = String(compositeId ?? "").trim();
  if (!normalized.startsWith("remote:")) {
    return null;
  }
  const parts = normalized.split(":");
  if (parts.length < 3) {
    return null;
  }
  const hostAgentId = parts[1]?.trim() ?? "";
  const workgroupId = parts.slice(2).join(":").trim();
  if (!hostAgentId || !workgroupId) {
    return null;
  }
  return { hostAgentId, workgroupId };
}

function sortMessages(messages: WorkgroupCollaborationMessage[]): WorkgroupCollaborationMessage[] {
  return [...messages].sort((left, right) => left.createdAt - right.createdAt || left.updatedAt - right.updatedAt || left.id.localeCompare(right.id));
}

export default class RemoteWorkgroupStore extends EventEmitter {
  private readonly relayClient: RelayClient;
  private readonly localAgentId: () => string;
  private registryByCompositeId = new Map<string, RemoteWorkgroupRegistryRecord>();
  private summariesByCompositeId = new Map<string, WorkgroupCollaborationSummary>();
  private sessionsByCompositeId = new Map<string, RemoteWorkgroupSessionState>();
  private pendingSessionRequests = new Map<string, PendingSessionRequest>();
  private pendingSendRequests = new Map<string, PendingSendRequest>();

  constructor(relayClient: RelayClient, options: { localAgentId: () => string }) {
    super();
    this.relayClient = relayClient;
    this.localAgentId = options.localAgentId;
  }

  setRegistryRecords(records: RemoteWorkgroupRegistryRecord[]): void {
    const localAgentId = this.localAgentId().trim();
    const nextRegistry = new Map<string, RemoteWorkgroupRegistryRecord>();
    for (const record of records) {
      const hostAgentId = normalizeText(record.hostAgentId);
      const workgroupId = normalizeText(record.workgroupId);
      if (!hostAgentId || !workgroupId || hostAgentId === localAgentId) {
        continue;
      }
      const compositeId = buildCompositeWorkgroupId(hostAgentId, workgroupId);
      nextRegistry.set(compositeId, {
        ...record,
        hostAgentId,
        workgroupId,
        description: normalizeNullableText(record.description),
        ownerUsername: normalizeNullableText(record.ownerUsername),
        memberCount: Number(record.memberCount ?? 0) || 0,
        updatedAt: Number(record.updatedAt ?? 0) || 0,
      });
    }

    this.registryByCompositeId = nextRegistry;
    for (const compositeId of Array.from(this.summariesByCompositeId.keys())) {
      if (!nextRegistry.has(compositeId)) {
        this.summariesByCompositeId.delete(compositeId);
        this.sessionsByCompositeId.delete(compositeId);
      }
    }
    this.emitSummaries();
  }

  listSummaries(): WorkgroupCollaborationSummary[] {
    const items = new Map<string, WorkgroupCollaborationSummary>();

    for (const [compositeId, record] of this.registryByCompositeId.entries()) {
      items.set(compositeId, {
        id: compositeId,
        name: record.name,
        description: record.description ?? null,
        updatedAt: record.updatedAt,
        isRunning: false,
        lastMessagePreview: record.groupNumber ? `#${record.groupNumber}` : null,
        messageCount: 0,
        memberCount: Math.max(0, Number(record.memberCount ?? 0)),
      });
    }

    for (const [compositeId, summary] of this.summariesByCompositeId.entries()) {
      items.set(compositeId, summary);
    }

    return Array.from(items.values())
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name, "zh-CN"));
  }

  requestSummaries(): void {
    if (!this.relayClient.isConnected()) {
      return;
    }
    const hostAgentIds = Array.from(
      new Set(
        Array.from(this.registryByCompositeId.values())
          .map((record) => record.hostAgentId)
          .filter(Boolean),
      ),
    );
    for (const hostAgentId of hostAgentIds) {
      this.relayClient.send({
        id: uuidv4(),
        event: Events.WORKGROUP_COLLABORATION_LIST_REQUEST,
        agent_id: hostAgentId,
        ts: Date.now(),
        payload: {
          agent_id: hostAgentId,
        },
      });
    }
  }

  getSession(compositeId: string): WorkgroupCollaborationSessionSnapshot | null {
    return this.sessionsByCompositeId.get(compositeId)?.session ?? null;
  }

  getHistoryPage(compositeId: string, options: { beforeId?: string | null; limit?: number } = {}): {
    items: WorkgroupCollaborationMessage[];
    hasMore: boolean;
    total: number;
  } | null {
    const session = this.getSession(compositeId);
    if (!session) {
      return null;
    }

    const messages = sortMessages(session.messages);
    const limit = Number(options.limit) > 0 ? Number(options.limit) : DEFAULT_PAGE_SIZE;
    const beforeId = normalizeText(options.beforeId);
    const anchorIndex = beforeId ? messages.findIndex((entry) => entry.id === beforeId) : messages.length;
    const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : messages.length;
    const startIndex = Math.max(0, safeAnchorIndex - limit);
    return {
      items: messages.slice(startIndex, safeAnchorIndex),
      hasMore: startIndex > 0 || messages.length < session.messageTotal,
      total: session.messageTotal,
    };
  }

  searchMessages(compositeId: string, options: { query: string; limit?: number }): WorkgroupCollaborationMessage[] | null {
    const session = this.getSession(compositeId);
    if (!session) {
      return null;
    }
    const query = normalizeText(options.query).toLowerCase();
    if (!query) {
      return [];
    }
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 200;
    return sortMessages(session.messages)
      .filter((message) => [message.senderType, message.senderName, message.memberRole ?? "", message.content].join(" ").toLowerCase().includes(query))
      .slice(-limit);
  }

  async requestSession(compositeId: string, options: { beforeId?: string | null; limit?: number } = {}): Promise<{ success: boolean; session?: WorkgroupCollaborationSessionSnapshot; error?: string }> {
    const parsed = parseCompositeWorkgroupId(compositeId);
    if (!parsed) {
      return { success: false, error: "Remote workgroup not found" };
    }
    if (!this.relayClient.isConnected()) {
      return { success: false, error: "Remote desktop is offline." };
    }

    const requestId = uuidv4();
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingSessionRequests.delete(requestId);
        resolve({ success: false, error: "Timed out while loading workgroup." });
      }, REQUEST_TIMEOUT_MS);
      this.pendingSessionRequests.set(requestId, {
        compositeId,
        resolve,
        timeout,
      });

      this.relayClient.send({
        id: requestId,
        event: Events.WORKGROUP_COLLABORATION_SESSION_REQUEST,
        agent_id: parsed.hostAgentId,
        workgroup_id: parsed.workgroupId,
        ts: Date.now(),
        payload: {
          agent_id: parsed.hostAgentId,
          workgroup_id: parsed.workgroupId,
          before_id: normalizeText(options.beforeId) || undefined,
          limit: Number(options.limit) > 0 ? Number(options.limit) : DEFAULT_PAGE_SIZE,
          snapshot_revision: !normalizeText(options.beforeId)
            ? this.sessionsByCompositeId.get(compositeId)?.session.snapshotRevision ?? undefined
            : undefined,
          known_items: this.buildKnownItems(compositeId, options.beforeId, options.limit),
        },
      });
    });
  }

  async sendMessage(compositeId: string, content: string): Promise<{ success: boolean; session?: WorkgroupCollaborationSessionSnapshot; error?: string }> {
    const parsed = parseCompositeWorkgroupId(compositeId);
    if (!parsed) {
      return { success: false, error: "Remote workgroup not found" };
    }
    if (!this.relayClient.isConnected()) {
      return { success: false, error: "Remote desktop is offline." };
    }

    const normalizedContent = String(content ?? "");
    if (!normalizedContent.trim()) {
      return { success: false, error: "Message cannot be empty" };
    }

    const requestId = uuidv4();
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingSendRequests.delete(requestId);
        resolve({ success: false, error: "Timed out while sending workgroup message." });
      }, REQUEST_TIMEOUT_MS);
      this.pendingSendRequests.set(requestId, {
        compositeId,
        resolve,
        timeout,
      });

      this.relayClient.send({
        id: requestId,
        event: Events.WORKGROUP_COLLABORATION_MESSAGE_SEND,
        agent_id: parsed.hostAgentId,
        workgroup_id: parsed.workgroupId,
        ts: Date.now(),
        payload: {
          agent_id: parsed.hostAgentId,
          workgroup_id: parsed.workgroupId,
          content: normalizedContent,
        },
      });
    });
  }

  handleEnvelope(env: Envelope): void {
    if (env.event === Events.WORKGROUP_COLLABORATION_LIST) {
      this.handleSummaryEnvelope(env);
      return;
    }
    if (env.event === Events.WORKGROUP_COLLABORATION_SESSION || env.event === Events.WORKGROUP_COLLABORATION_SNAPSHOT) {
      this.handleSessionEnvelope(env);
      return;
    }
    if (env.event === Events.WORKGROUP_COLLABORATION_MESSAGE_RESULT) {
      this.handleMessageResultEnvelope(env);
    }
  }

  private handleSummaryEnvelope(env: Envelope): void {
    const payload = (env.payload ?? {}) as Record<string, unknown>;
    const hostAgentId = normalizeText(env.agent_id ?? payload.agent_id);
    if (!hostAgentId) {
      return;
    }

    const registeredIds = new Set(
      Array.from(this.registryByCompositeId.entries())
        .filter(([, record]) => record.hostAgentId === hostAgentId)
        .map(([compositeId]) => compositeId),
    );
    if (registeredIds.size === 0) {
      return;
    }

    const summaries = Array.isArray(payload.workgroups) ? payload.workgroups as Array<Record<string, unknown>> : [];
    for (const compositeId of registeredIds) {
      const record = this.registryByCompositeId.get(compositeId);
      if (!record) {
        continue;
      }
      const summaryPayload = summaries.find((entry) => normalizeText(entry.id) === record.workgroupId);
      this.summariesByCompositeId.set(compositeId, summaryPayload
        ? this.parseSummary(hostAgentId, record, summaryPayload)
        : {
            id: compositeId,
            name: record.name,
            description: record.description ?? null,
            updatedAt: record.updatedAt,
            isRunning: false,
            lastMessagePreview: record.groupNumber ? `#${record.groupNumber}` : null,
            messageCount: 0,
            memberCount: Math.max(0, Number(record.memberCount ?? 0)),
          });
    }
    this.emitSummaries();
  }

  private handleSessionEnvelope(env: Envelope): void {
    const payload = (env.payload ?? {}) as Record<string, unknown>;
    const hostAgentId = normalizeText(env.agent_id ?? payload.agent_id);
    const sessionPayload = (payload.session ?? null) as Record<string, unknown> | null;
    const pagePayload = (payload.page ?? null) as Record<string, unknown> | null;
    const snapshotRevision = normalizeText(payload.snapshot_revision ?? sessionPayload?.snapshotRevision ?? sessionPayload?.snapshot_revision);
    const snapshotUnchanged = Boolean(payload.snapshot_unchanged);
    const beforeId = normalizeText(payload.before_id);
    const sourceWorkgroupId = normalizeText(env.workgroup_id ?? payload.workgroup_id ?? sessionPayload?.workgroupId);
    if (!hostAgentId || !sessionPayload || !sourceWorkgroupId) {
      return;
    }

    const compositeId = buildCompositeWorkgroupId(hostAgentId, sourceWorkgroupId);
    if (!this.registryByCompositeId.has(compositeId)) {
      return;
    }
    const existingSession = this.sessionsByCompositeId.get(compositeId)?.session ?? null;
    if (
      !beforeId
      && snapshotUnchanged
      && snapshotRevision
      && existingSession?.snapshotRevision === snapshotRevision
    ) {
      const requestId = normalizeText(payload.request_id);
      if (requestId) {
        const pending = this.pendingSessionRequests.get(requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingSessionRequests.delete(requestId);
          pending.resolve({ success: true, session: existingSession });
        }
      }
      return;
    }

    const nextSession = this.parseSession(
      hostAgentId,
      compositeId,
      sourceWorkgroupId,
      sessionPayload,
      existingSession,
      pagePayload,
      snapshotRevision || null,
    );
    this.sessionsByCompositeId.set(compositeId, {
      compositeId,
      hostAgentId,
      sourceWorkgroupId,
      session: nextSession,
    });
    this.summariesByCompositeId.set(compositeId, {
      id: compositeId,
      name: nextSession.workgroupName,
      description: nextSession.description ?? null,
      updatedAt: nextSession.updatedAt,
      isRunning: nextSession.isRunning,
      lastMessagePreview: [...nextSession.messages].reverse().find((message) => message.content.trim())?.content.slice(0, 120) ?? null,
      messageCount: nextSession.messageTotal,
      memberCount: nextSession.members.length,
    });

    const requestId = normalizeText(payload.request_id);
    if (requestId) {
      const pending = this.pendingSessionRequests.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingSessionRequests.delete(requestId);
        pending.resolve({ success: true, session: nextSession });
      }
    }

    this.emit("snapshot", compositeId, nextSession);
    this.emitSummaries();
  }

  private handleMessageResultEnvelope(env: Envelope): void {
    const payload = (env.payload ?? {}) as Record<string, unknown>;
    const requestId = normalizeText(payload.request_id);
    const pending = requestId ? this.pendingSendRequests.get(requestId) : null;
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingSendRequests.delete(requestId);

    const success = Boolean(payload.success);
    if (!success) {
      pending.resolve({
        success: false,
        error: normalizeText(payload.error) || "Failed to send workgroup message.",
      });
      return;
    }

    const sessionPayload = (payload.session ?? null) as Record<string, unknown> | null;
    if (sessionPayload) {
      const composite = parseCompositeWorkgroupId(pending.compositeId);
      if (composite) {
        const nextSession = this.parseSession(
          composite.hostAgentId,
          pending.compositeId,
          composite.workgroupId,
          sessionPayload,
          this.sessionsByCompositeId.get(pending.compositeId)?.session ?? null,
        );
        this.sessionsByCompositeId.set(pending.compositeId, {
          compositeId: pending.compositeId,
          hostAgentId: composite.hostAgentId,
          sourceWorkgroupId: composite.workgroupId,
          session: nextSession,
        });
        this.emit("snapshot", pending.compositeId, nextSession);
        this.emitSummaries();
        pending.resolve({ success: true, session: nextSession });
        return;
      }
    }

    pending.resolve({ success: true, session: this.getSession(pending.compositeId) ?? undefined });
  }

  private parseSummary(hostAgentId: string, record: RemoteWorkgroupRegistryRecord, payload: Record<string, unknown>): WorkgroupCollaborationSummary {
    const compositeId = buildCompositeWorkgroupId(hostAgentId, record.workgroupId);
    return {
      id: compositeId,
      name: normalizeText(payload.name) || record.name,
      description: normalizeNullableText(payload.description) ?? record.description ?? null,
      updatedAt: Number(payload.updatedAt ?? record.updatedAt) || record.updatedAt,
      isRunning: Boolean(payload.isRunning),
      lastMessagePreview: normalizeNullableText(payload.lastMessagePreview),
      messageCount: Number(payload.messageCount ?? 0) || 0,
      memberCount: Number(payload.memberCount ?? record.memberCount ?? 0) || 0,
    };
  }

  private parseSession(
    hostAgentId: string,
    compositeId: string,
    sourceWorkgroupId: string,
    payload: Record<string, unknown>,
    existing: WorkgroupCollaborationSessionSnapshot | null,
    pagePayload?: Record<string, unknown> | null,
    snapshotRevision?: string | null,
  ): WorkgroupCollaborationSessionSnapshot {
    const existingMessagesById = new Map((existing?.messages ?? []).map((message) => [message.id, message]));
    const incomingMessages = Array.isArray(payload.messages)
      ? payload.messages
          .map((entry) => this.parseMessage(entry as Record<string, unknown>, compositeId, existingMessagesById))
          .filter((entry): entry is WorkgroupCollaborationMessage => Boolean(entry))
      : [];
    const pageMessages = Array.isArray(pagePayload?.items)
      ? pagePayload.items
          .map((entry) => this.parseMessage(entry as Record<string, unknown>, compositeId, existingMessagesById))
          .filter((entry): entry is WorkgroupCollaborationMessage => Boolean(entry))
      : [];
    const mergedMessages = new Map((existing?.messages ?? []).map((message) => [message.id, message]));
    for (const message of incomingMessages) {
      mergedMessages.set(message.id, message);
    }
    for (const message of pageMessages) {
      mergedMessages.set(message.id, message);
    }

    return {
      workgroupId: compositeId,
      workgroupName: normalizeText(payload.workgroupName) || normalizeText(payload.workgroup_name) || compositeId,
      description: normalizeNullableText(payload.description),
      allowDirectMemberMessages: Boolean(payload.allowDirectMemberMessages ?? payload.allow_direct_member_messages),
      updatedAt: Number(payload.updatedAt ?? payload.updated_at ?? Date.now()) || Date.now(),
      isRunning: Boolean(payload.isRunning),
      messageTotal: Number(payload.messageTotal ?? payload.message_total ?? mergedMessages.size) || mergedMessages.size,
      snapshotRevision: snapshotRevision?.trim() || normalizeText(payload.snapshotRevision ?? payload.snapshot_revision) || existing?.snapshotRevision || "",
      members: Array.isArray(payload.members)
        ? payload.members
            .map((entry) => this.parseMember(entry as Record<string, unknown>))
            .filter((entry): entry is WorkgroupCollaborationMemberSnapshot => Boolean(entry))
        : (existing?.members ?? []),
      messages: sortMessages(Array.from(mergedMessages.values())).map((message) => ({
        ...message,
        workgroupId: compositeId,
      })),
    };
  }

  private parseMember(payload: Record<string, unknown>): WorkgroupCollaborationMemberSnapshot | null {
    const id = normalizeText(payload.id);
    if (!id) {
      return null;
    }
    return {
      id,
      name: normalizeText(payload.name) || id,
      role: normalizeRole(payload.role),
      projectId: normalizeNullableText(payload.projectId),
      projectName: normalizeNullableText(payload.projectName),
      projectKind: payload.projectKind === "local" || payload.projectKind === "remote" ? payload.projectKind : null,
      projectOnline: Boolean(payload.projectOnline),
      hasBinding: Boolean(payload.hasBinding),
      isRunning: Boolean(payload.isRunning),
    };
  }

  private parseMessage(
    payload: Record<string, unknown>,
    compositeId: string,
    existingById: Map<string, WorkgroupCollaborationMessage>,
  ): WorkgroupCollaborationMessage | null {
    const id = normalizeText(payload.id);
    if (!id) {
      return null;
    }
    const existing = existingById.get(id) ?? null;
    const contentMd5 = normalizeText(payload.content_md5);
    const contentOmitted = Boolean(payload.content_omitted);
    const resolvedContent = contentOmitted && existing && contentMd5 && createSessionSyncContentMd5(existing.content) === contentMd5
      ? existing.content
      : String(payload.content ?? "");
    return {
      id,
      workgroupId: compositeId,
      senderType: normalizeSenderType(payload.senderType),
      senderName: normalizeText(payload.senderName) || "Unknown",
      memberId: normalizeNullableText(payload.memberId),
      memberRole: normalizeNullableRole(payload.memberRole),
      projectId: normalizeNullableText(payload.projectId),
      projectKind: payload.projectKind === "local" || payload.projectKind === "remote" ? payload.projectKind : null,
      dispatchRunId: normalizeNullableText(payload.dispatchRunId),
      triggerMessageId: normalizeNullableText(payload.triggerMessageId),
      content: resolvedContent,
      status: normalizeText(payload.status) === "streaming" ? "streaming" : "done",
      createdAt: Number(payload.createdAt ?? 0) || 0,
      updatedAt: Number(payload.updatedAt ?? 0) || 0,
    };
  }

  private buildKnownItems(compositeId: string, beforeId?: string | null, limit?: number): Array<{ id: string; content_md5: string }> {
    const session = this.getSession(compositeId);
    if (!session) {
      return [];
    }
    const messages = sortMessages(session.messages);
    const anchorIndex = normalizeText(beforeId)
      ? messages.findIndex((message) => message.id === normalizeText(beforeId))
      : messages.length;
    const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : messages.length;
    const maxItems = Math.max(KNOWN_ITEM_LIMIT, (Number(limit) > 0 ? Number(limit) : DEFAULT_PAGE_SIZE) * 2);
    return messages
      .slice(0, safeAnchorIndex)
      .slice(-maxItems)
      .map((message) => ({
        id: message.id,
        content_md5: createSessionSyncContentMd5(message.content),
      }));
  }

  private emitSummaries(): void {
    this.emit("summaries", this.listSummaries());
  }
}
