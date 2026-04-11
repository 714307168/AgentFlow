import { createHash } from "crypto";
import { createSessionSyncContentMd5, type SessionSyncKnownItemDigest } from "./session-sync-hash";
import type {
  WorkgroupCollaborationSessionSnapshot,
} from "./workgroup-collaboration-service";

type RelayMessage = WorkgroupCollaborationSessionSnapshot["messages"][number] & {
  content_md5: string;
  content_omitted?: boolean;
};

type RelaySession = Omit<WorkgroupCollaborationSessionSnapshot, "messages"> & {
  messages: RelayMessage[];
};

type RelayPage = {
  items: RelayMessage[];
  hasMore: boolean;
  total: number;
};

export interface WorkgroupCollaborationSessionRelayPayload {
  agent_id: string;
  workgroup_id: string;
  snapshot_revision: string;
  snapshot_unchanged?: boolean;
  session: RelaySession;
  page: RelayPage;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

export function createWorkgroupCollaborationSnapshotRevision(
  session: WorkgroupCollaborationSessionSnapshot,
): string {
  const normalizedMembers = [...session.members]
    .map((member) => ({
      id: member.id,
      name: normalizeText(member.name),
      role: member.role,
      projectId: member.projectId ?? "",
      projectName: normalizeText(member.projectName),
      projectKind: member.projectKind ?? "",
      projectOnline: member.projectOnline,
      hasBinding: member.hasBinding,
      isRunning: member.isRunning,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const normalizedMessages = [...session.messages]
    .map((message) => ({
      id: message.id,
      senderType: message.senderType,
      senderName: normalizeText(message.senderName),
      memberId: message.memberId ?? "",
      memberRole: message.memberRole ?? "",
      projectId: message.projectId ?? "",
      projectKind: message.projectKind ?? "",
      dispatchRunId: message.dispatchRunId ?? "",
      triggerMessageId: message.triggerMessageId ?? "",
      status: message.status,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      contentMd5: createSessionSyncContentMd5(message.content),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return createHash("sha1")
    .update(JSON.stringify({
      workgroupId: session.workgroupId,
      workgroupName: normalizeText(session.workgroupName),
      description: normalizeText(session.description),
      allowDirectMemberMessages: session.allowDirectMemberMessages,
      updatedAt: session.updatedAt,
      isRunning: session.isRunning,
      messageTotal: session.messageTotal,
      members: normalizedMembers,
      messages: normalizedMessages,
    }), "utf8")
    .digest("hex");
}

export function buildWorkgroupCollaborationSessionRelayPayload(data: {
  agentId: string;
  workgroupId: string;
  session: WorkgroupCollaborationSessionSnapshot;
  page: {
    items: WorkgroupCollaborationSessionSnapshot["messages"];
    hasMore: boolean;
    total: number;
  };
  beforeId?: string | null;
  knownItems?: SessionSyncKnownItemDigest[];
  knownSnapshotRevision?: string | null;
}): WorkgroupCollaborationSessionRelayPayload {
  const snapshotRevision = data.session.snapshotRevision?.trim()
    || createWorkgroupCollaborationSnapshotRevision(data.session);
  const knownMap = new Map<string, string>();
  for (const item of data.knownItems ?? []) {
    const id = String(item?.id ?? "").trim();
    const contentMd5 = typeof item?.content_md5 === "string" ? item.content_md5.trim() : "";
    if (id && contentMd5) {
      knownMap.set(id, contentMd5);
    }
  }

  const normalizeMessages = <T extends WorkgroupCollaborationSessionSnapshot["messages"][number]>(messages: T[]): RelayMessage[] => {
    return messages.map((message) => {
      const contentMd5 = createSessionSyncContentMd5(message.content);
      const shouldOmitContent = knownMap.get(message.id) === contentMd5;
      return {
        ...message,
        content: shouldOmitContent ? "" : message.content,
        content_md5: contentMd5,
        content_omitted: shouldOmitContent || undefined,
      };
    });
  };

  const payload: WorkgroupCollaborationSessionRelayPayload = {
    agent_id: data.agentId.trim(),
    workgroup_id: data.workgroupId,
    snapshot_revision: snapshotRevision,
    session: {
      ...data.session,
      snapshotRevision,
      messages: normalizeMessages(data.session.messages),
    },
    page: {
      ...data.page,
      items: normalizeMessages(data.page.items),
    },
  };

  if (
    !String(data.beforeId ?? "").trim()
    && snapshotRevision === String(data.knownSnapshotRevision ?? "").trim()
  ) {
    return {
      ...payload,
      snapshot_unchanged: true,
      session: {
        ...payload.session,
        messages: [],
      },
      page: {
        ...payload.page,
        items: [],
        hasMore: false,
      },
    };
  }

  return payload;
}
