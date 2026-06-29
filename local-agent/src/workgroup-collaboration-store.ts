import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";
import { getDesktopDatabase, getSqliteMigrationFlag, setSqliteMigrationFlag } from "./desktop-sqlite-store";
import type { WorkgroupRole } from "./workgroup-store";

export type WorkgroupCollaborationSenderType = "user" | "member" | "system" | "error";
export type WorkgroupCollaborationMessageStatus = "streaming" | "done";
export type WorkgroupCollaborationProjectKind = "local" | "remote" | null;

export interface WorkgroupCollaborationMessage {
  id: string;
  workgroupId: string;
  senderType: WorkgroupCollaborationSenderType;
  senderName: string;
  memberId?: string | null;
  memberRole?: WorkgroupRole | null;
  projectId?: string | null;
  projectKind?: WorkgroupCollaborationProjectKind;
  dispatchRunId?: string | null;
  triggerMessageId?: string | null;
  content: string;
  status: WorkgroupCollaborationMessageStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WorkgroupCollaborationSessionRecord {
  workgroupId: string;
  createdAt: number;
  updatedAt: number;
  messages: WorkgroupCollaborationMessage[];
}

interface WorkgroupCollaborationStoreSchema {
  sessions: WorkgroupCollaborationSessionRecord[];
}

interface SessionRow {
  workgroup_id: string;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  workgroup_id: string;
  sender_type: string;
  sender_name: string;
  member_id: string | null;
  member_role: string | null;
  project_id: string | null;
  project_kind: string | null;
  dispatch_run_id: string | null;
  trigger_message_id: string | null;
  content: string;
  status: string;
  created_at: number;
  updated_at: number;
}

const DEFAULT_HISTORY_PAGE_SIZE = 30;
const SQLITE_MIGRATION_KEY = "workgroup-collaborations-json-imported";

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeProjectKind(value: string | null | undefined): WorkgroupCollaborationProjectKind {
  if (value === "local" || value === "remote") {
    return value;
  }
  return null;
}

function normalizeSenderType(value: string | null | undefined): WorkgroupCollaborationSenderType {
  if (value === "user" || value === "member" || value === "system" || value === "error") {
    return value;
  }
  return "system";
}

function normalizeMemberRole(value: WorkgroupRole | string | null | undefined): WorkgroupRole | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "project_manager" || normalized === "pm") {
    return "project_manager";
  }
  return "member";
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : fallback;
}

function normalizeMessage(message: WorkgroupCollaborationMessage): WorkgroupCollaborationMessage {
  const createdAt = normalizeTimestamp(message.createdAt, Date.now());
  const updatedAt = Math.max(normalizeTimestamp(message.updatedAt, createdAt), createdAt);
  return {
    ...message,
    id: String(message.id ?? "").trim() || uuidv4(),
    workgroupId: String(message.workgroupId ?? "").trim(),
    senderType: normalizeSenderType(message.senderType),
    senderName: String(message.senderName ?? "").trim() || "Unknown",
    memberId: normalizeNullableText(message.memberId),
    memberRole: normalizeMemberRole(message.memberRole),
    projectId: normalizeNullableText(message.projectId),
    projectKind: normalizeProjectKind(message.projectKind),
    dispatchRunId: normalizeNullableText(message.dispatchRunId),
    triggerMessageId: normalizeNullableText(message.triggerMessageId),
    content: String(message.content ?? ""),
    status: message.status === "streaming" ? "streaming" : "done",
    createdAt,
    updatedAt,
  };
}

function cloneMessage(message: WorkgroupCollaborationMessage): WorkgroupCollaborationMessage {
  return normalizeMessage({ ...message });
}

function messageFromRow(row: MessageRow): WorkgroupCollaborationMessage {
  return normalizeMessage({
    id: row.id,
    workgroupId: row.workgroup_id,
    senderType: normalizeSenderType(row.sender_type),
    senderName: row.sender_name,
    memberId: row.member_id,
    memberRole: normalizeMemberRole(row.member_role),
    projectId: row.project_id,
    projectKind: normalizeProjectKind(row.project_kind),
    dispatchRunId: row.dispatch_run_id,
    triggerMessageId: row.trigger_message_id,
    content: row.content,
    status: row.status === "streaming" ? "streaming" : "done",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function cloneSession(session: WorkgroupCollaborationSessionRecord): WorkgroupCollaborationSessionRecord {
  return {
    workgroupId: session.workgroupId,
    createdAt: normalizeTimestamp(session.createdAt, Date.now()),
    updatedAt: normalizeTimestamp(session.updatedAt, Date.now()),
    messages: Array.isArray(session.messages) ? session.messages.map(cloneMessage) : [],
  };
}

class WorkgroupCollaborationStore {
  private readonly db = getDesktopDatabase();
  private readonly listSessionsStatement = this.db.prepare(
    "SELECT workgroup_id, created_at, updated_at FROM workgroup_collaboration_sessions ORDER BY updated_at DESC, workgroup_id ASC",
  );
  private readonly getSessionStatement = this.db.prepare(
    "SELECT workgroup_id, created_at, updated_at FROM workgroup_collaboration_sessions WHERE workgroup_id = ?",
  );
  private readonly upsertSessionStatement = this.db.prepare(
    "INSERT INTO workgroup_collaboration_sessions (workgroup_id, created_at, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(workgroup_id) DO UPDATE SET updated_at = excluded.updated_at",
  );
  private readonly deleteSessionStatement = this.db.prepare(
    "DELETE FROM workgroup_collaboration_sessions WHERE workgroup_id = ?",
  );
  private readonly listMessagesStatement = this.db.prepare(
    "SELECT * FROM workgroup_collaboration_messages WHERE workgroup_id = ? ORDER BY created_at ASC, updated_at ASC, id ASC",
  );
  private readonly getMessageStatement = this.db.prepare(
    "SELECT * FROM workgroup_collaboration_messages WHERE workgroup_id = ? AND id = ?",
  );
  private readonly upsertMessageStatement = this.db.prepare(
    "INSERT INTO workgroup_collaboration_messages (" +
      "id, workgroup_id, sender_type, sender_name, member_id, member_role, project_id, project_kind, " +
      "dispatch_run_id, trigger_message_id, content, status, created_at, updated_at" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET " +
      "sender_type = excluded.sender_type, sender_name = excluded.sender_name, member_id = excluded.member_id, " +
      "member_role = excluded.member_role, project_id = excluded.project_id, project_kind = excluded.project_kind, " +
      "dispatch_run_id = excluded.dispatch_run_id, trigger_message_id = excluded.trigger_message_id, " +
      "content = excluded.content, status = excluded.status, updated_at = excluded.updated_at",
  );

  constructor() {
    this.migrateLegacyStore();
  }

  listSessions(): WorkgroupCollaborationSessionRecord[] {
    return (this.listSessionsStatement.all() as SessionRow[])
      .map((row) => ({
        workgroupId: row.workgroup_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messages: this.listMessages(row.workgroup_id),
      }))
      .map(cloneSession);
  }

  getSession(workgroupId: string): WorkgroupCollaborationSessionRecord | null {
    const normalizedWorkgroupId = String(workgroupId ?? "").trim();
    if (!normalizedWorkgroupId) {
      return null;
    }
    const row = this.getSessionStatement.get(normalizedWorkgroupId) as SessionRow | undefined;
    if (!row) {
      return null;
    }
    return cloneSession({
      workgroupId: row.workgroup_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: this.listMessages(row.workgroup_id),
    });
  }

  ensureSession(workgroupId: string): WorkgroupCollaborationSessionRecord {
    const normalizedWorkgroupId = String(workgroupId ?? "").trim();
    const existing = this.getSession(normalizedWorkgroupId);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    this.upsertSessionStatement.run(normalizedWorkgroupId, now, now);
    return {
      workgroupId: normalizedWorkgroupId,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
  }

  removeSession(workgroupId: string): void {
    const normalizedWorkgroupId = String(workgroupId ?? "").trim();
    if (!normalizedWorkgroupId) {
      return;
    }
    this.deleteSessionStatement.run(normalizedWorkgroupId);
  }

  listMessages(workgroupId: string): WorkgroupCollaborationMessage[] {
    const normalizedWorkgroupId = String(workgroupId ?? "").trim();
    if (!normalizedWorkgroupId) {
      return [];
    }
    return (this.listMessagesStatement.all(normalizedWorkgroupId) as MessageRow[])
      .map(messageFromRow);
  }

  getMessage(workgroupId: string, messageId: string): WorkgroupCollaborationMessage | null {
    const normalizedWorkgroupId = String(workgroupId ?? "").trim();
    const normalizedMessageId = String(messageId ?? "").trim();
    if (!normalizedWorkgroupId || !normalizedMessageId) {
      return null;
    }
    const row = this.getMessageStatement.get(normalizedWorkgroupId, normalizedMessageId) as MessageRow | undefined;
    return row ? messageFromRow(row) : null;
  }

  appendMessage(
    workgroupId: string,
    input: Omit<WorkgroupCollaborationMessage, "id" | "workgroupId" | "createdAt" | "updatedAt"> & { id?: string },
  ): WorkgroupCollaborationMessage {
    const session = this.ensureSession(workgroupId);
    const now = Date.now();
    const nextMessage = normalizeMessage({
      id: input.id?.trim() || uuidv4(),
      workgroupId: session.workgroupId,
      senderType: input.senderType,
      senderName: input.senderName,
      memberId: input.memberId,
      memberRole: input.memberRole,
      projectId: input.projectId,
      projectKind: input.projectKind,
      dispatchRunId: input.dispatchRunId,
      triggerMessageId: input.triggerMessageId,
      content: input.content,
      status: input.status,
      createdAt: now,
      updatedAt: now,
    });

    this.persistMessage(nextMessage);
    this.touchSession(session.workgroupId, now);
    return cloneMessage(nextMessage);
  }

  updateMessage(
    workgroupId: string,
    messageId: string,
    patch: Partial<Omit<WorkgroupCollaborationMessage, "id" | "workgroupId" | "createdAt">>,
  ): WorkgroupCollaborationMessage | null {
    const current = this.getMessage(workgroupId, messageId);
    if (!current) {
      return null;
    }

    const now = Date.now();
    const nextMessage = normalizeMessage({
      ...current,
      ...patch,
      id: current.id,
      workgroupId: current.workgroupId,
      createdAt: current.createdAt,
      updatedAt: now,
    });
    this.persistMessage(nextMessage);
    this.touchSession(nextMessage.workgroupId, now);
    return cloneMessage(nextMessage);
  }

  appendToMessage(workgroupId: string, messageId: string, chunk: string): WorkgroupCollaborationMessage | null {
    if (!chunk) {
      return this.getMessage(workgroupId, messageId);
    }

    const current = this.getMessage(workgroupId, messageId);
    if (!current) {
      return null;
    }

    return this.updateMessage(workgroupId, messageId, {
      content: current.content + chunk,
      status: "streaming",
    });
  }

  getHistoryPage(
    workgroupId: string,
    options: {
      beforeId?: string | null;
      limit?: number;
    } = {},
  ): {
    items: WorkgroupCollaborationMessage[];
    hasMore: boolean;
    total: number;
  } {
    const messages = this.listMessages(workgroupId);
    const limit = Number(options.limit) > 0 ? Number(options.limit) : DEFAULT_HISTORY_PAGE_SIZE;
    const beforeId = options.beforeId?.trim() ?? "";
    const anchorIndex = beforeId
      ? messages.findIndex((entry) => entry.id === beforeId)
      : messages.length;
    const safeAnchorIndex = anchorIndex >= 0 ? anchorIndex : messages.length;
    const startIndex = Math.max(0, safeAnchorIndex - limit);

    return {
      items: messages.slice(startIndex, safeAnchorIndex).map(cloneMessage),
      hasMore: startIndex > 0,
      total: messages.length,
    };
  }

  private persistMessage(message: WorkgroupCollaborationMessage): void {
    this.upsertMessageStatement.run(
      message.id,
      message.workgroupId,
      message.senderType,
      message.senderName,
      message.memberId ?? null,
      message.memberRole ?? null,
      message.projectId ?? null,
      message.projectKind ?? null,
      message.dispatchRunId ?? null,
      message.triggerMessageId ?? null,
      message.content,
      message.status,
      message.createdAt,
      message.updatedAt,
    );
  }

  private touchSession(workgroupId: string, updatedAt: number): void {
    const session = this.getSession(workgroupId);
    this.upsertSessionStatement.run(
      workgroupId,
      session?.createdAt ?? updatedAt,
      updatedAt,
    );
  }

  private migrateLegacyStore(): void {
    if (getSqliteMigrationFlag(SQLITE_MIGRATION_KEY) === "1") {
      return;
    }

    try {
      const legacyStore = new Store<WorkgroupCollaborationStoreSchema>({
        name: "workgroup-collaborations",
        defaults: {
          sessions: [],
        },
      });
      const sessions = legacyStore.get("sessions", []).map(cloneSession);
      const importLegacySession = this.db.transaction((session: WorkgroupCollaborationSessionRecord) => {
        this.upsertSessionStatement.run(session.workgroupId, session.createdAt, session.updatedAt);
        for (const message of session.messages) {
          this.persistMessage({
            ...message,
            workgroupId: session.workgroupId,
          });
        }
      });

      for (const session of sessions) {
        const existing = this.getSessionStatement.get(session.workgroupId) as SessionRow | undefined;
        if (!existing) {
          importLegacySession(session);
        }
      }
      setSqliteMigrationFlag(SQLITE_MIGRATION_KEY, "1");
    } catch (_error) {
      // Leave the flag unset so the next startup can retry the import.
    }
  }
}

export default new WorkgroupCollaborationStore();
