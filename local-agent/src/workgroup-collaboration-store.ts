import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";
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

const DEFAULT_HISTORY_PAGE_SIZE = 30;

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

function normalizeMessage(message: WorkgroupCollaborationMessage): WorkgroupCollaborationMessage {
  return {
    ...message,
    senderName: String(message.senderName ?? "").trim() || "Unknown",
    memberId: normalizeNullableText(message.memberId),
    memberRole: message.memberRole ?? null,
    projectId: normalizeNullableText(message.projectId),
    projectKind: normalizeProjectKind(message.projectKind),
    dispatchRunId: normalizeNullableText(message.dispatchRunId),
    triggerMessageId: normalizeNullableText(message.triggerMessageId),
    content: String(message.content ?? ""),
    status: message.status === "streaming" ? "streaming" : "done",
    createdAt: Number(message.createdAt ?? Date.now()),
    updatedAt: Number(message.updatedAt ?? Date.now()),
  };
}

function cloneMessage(message: WorkgroupCollaborationMessage): WorkgroupCollaborationMessage {
  return normalizeMessage({ ...message });
}

function cloneSession(session: WorkgroupCollaborationSessionRecord): WorkgroupCollaborationSessionRecord {
  return {
    workgroupId: session.workgroupId,
    createdAt: Number(session.createdAt ?? Date.now()),
    updatedAt: Number(session.updatedAt ?? Date.now()),
    messages: Array.isArray(session.messages) ? session.messages.map(cloneMessage) : [],
  };
}

class WorkgroupCollaborationStore {
  private readonly store = new Store<WorkgroupCollaborationStoreSchema>({
    name: "workgroup-collaborations",
    defaults: {
      sessions: [],
    },
  });

  listSessions(): WorkgroupCollaborationSessionRecord[] {
    return this.store.get("sessions", []).map(cloneSession);
  }

  getSession(workgroupId: string): WorkgroupCollaborationSessionRecord | null {
    const normalizedWorkgroupId = String(workgroupId ?? "").trim();
    if (!normalizedWorkgroupId) {
      return null;
    }
    return this.listSessions().find((entry) => entry.workgroupId === normalizedWorkgroupId) ?? null;
  }

  ensureSession(workgroupId: string): WorkgroupCollaborationSessionRecord {
    const normalizedWorkgroupId = String(workgroupId ?? "").trim();
    const existing = this.getSession(normalizedWorkgroupId);
    if (existing) {
      return existing;
    }

    const next: WorkgroupCollaborationSessionRecord = {
      workgroupId: normalizedWorkgroupId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
    const sessions = this.listSessions();
    sessions.push(next);
    this.store.set("sessions", sessions);
    return cloneSession(next);
  }

  removeSession(workgroupId: string): void {
    const normalizedWorkgroupId = String(workgroupId ?? "").trim();
    this.store.set(
      "sessions",
      this.listSessions().filter((entry) => entry.workgroupId !== normalizedWorkgroupId),
    );
  }

  listMessages(workgroupId: string): WorkgroupCollaborationMessage[] {
    return this.getSession(workgroupId)?.messages.map(cloneMessage) ?? [];
  }

  getMessage(workgroupId: string, messageId: string): WorkgroupCollaborationMessage | null {
    const normalizedMessageId = String(messageId ?? "").trim();
    if (!normalizedMessageId) {
      return null;
    }
    return this.listMessages(workgroupId).find((entry) => entry.id === normalizedMessageId) ?? null;
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

    const sessions = this.listSessions().map((entry) => {
      if (entry.workgroupId !== session.workgroupId) {
        return entry;
      }
      return {
        ...entry,
        updatedAt: now,
        messages: [...entry.messages, nextMessage],
      };
    });
    this.store.set("sessions", sessions);
    return cloneMessage(nextMessage);
  }

  updateMessage(
    workgroupId: string,
    messageId: string,
    patch: Partial<Omit<WorkgroupCollaborationMessage, "id" | "workgroupId" | "createdAt">>,
  ): WorkgroupCollaborationMessage | null {
    const session = this.getSession(workgroupId);
    if (!session) {
      return null;
    }

    let nextMessage: WorkgroupCollaborationMessage | null = null;
    const now = Date.now();
    const sessions = this.listSessions().map((entry) => {
      if (entry.workgroupId !== session.workgroupId) {
        return entry;
      }

      const nextMessages = entry.messages.map((message) => {
        if (message.id !== messageId) {
          return message;
        }
        nextMessage = normalizeMessage({
          ...message,
          ...patch,
          id: message.id,
          workgroupId: message.workgroupId,
          createdAt: message.createdAt,
          updatedAt: now,
        });
        return nextMessage;
      });

      return {
        ...entry,
        updatedAt: nextMessage ? now : entry.updatedAt,
        messages: nextMessages,
      };
    });

    this.store.set("sessions", sessions);
    return nextMessage ? cloneMessage(nextMessage) : null;
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
      content: `${current.content}${chunk}`,
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
}

export default new WorkgroupCollaborationStore();
