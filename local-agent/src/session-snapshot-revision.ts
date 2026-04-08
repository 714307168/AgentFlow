import { createHash } from "crypto";
import type { ProjectSessionSnapshot } from "./runtime-types";

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function buildSnapshotRevisionSource(snapshot: ProjectSessionSnapshot): string {
  const normalizedConversations = [...snapshot.conversations]
    .map((conversation) => ({
      id: conversation.id,
      title: normalizeText(conversation.title),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      isActive: conversation.isActive,
      messageCount: conversation.messageCount,
      activityCount: conversation.activityCount,
      cliCount: conversation.cliCount,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const normalizedQueue = [...snapshot.queue]
    .map((entry) => ({
      runId: entry.runId,
      prompt: normalizeText(entry.prompt),
      source: entry.source,
      queuedAt: entry.queuedAt,
    }))
    .sort((left, right) => left.queuedAt - right.queuedAt || left.runId.localeCompare(right.runId));

  return JSON.stringify({
    projectId: snapshot.projectId,
    provider: snapshot.provider,
    model: snapshot.model ?? "",
    isRunning: snapshot.isRunning,
    queuedCount: snapshot.queuedCount,
    currentSource: snapshot.currentSource ?? "",
    currentPrompt: normalizeText(snapshot.currentPrompt),
    currentStartedAt: snapshot.currentStartedAt ?? 0,
    activeConversationId: snapshot.activeConversationId ?? "",
    sessionRefs: {
      claudeSessionId: snapshot.sessionRefs.claudeSessionId ?? "",
      codexThreadId: snapshot.sessionRefs.codexThreadId ?? "",
    },
    conversations: normalizedConversations,
    queue: normalizedQueue,
  });
}

export function createSessionSnapshotRevision(snapshot: ProjectSessionSnapshot): string {
  return createHash("sha1")
    .update(buildSnapshotRevisionSource(snapshot), "utf8")
    .digest("hex");
}
