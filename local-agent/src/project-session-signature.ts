import { createHash } from "crypto";
import type { ProjectSessionSnapshot } from "./runtime-types";

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function truncateText(value: string | null | undefined, maxChars: number): string {
  const normalized = normalizeText(value);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(0, maxChars);
}

function latestMessagePreview(snapshot: ProjectSessionSnapshot): string {
  const latestMessage = [...snapshot.messages]
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)[0];
  if (!latestMessage) {
    return "";
  }
  return truncateText(latestMessage.content, 240);
}

function latestMessageRole(snapshot: ProjectSessionSnapshot): string {
  const latestMessage = [...snapshot.messages]
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)[0];
  return latestMessage?.role ?? "";
}

function latestActivityTimestamp(snapshot: ProjectSessionSnapshot): number {
  return snapshot.activities.reduce((latest, entry) => Math.max(latest, entry.updatedAt, entry.createdAt), 0);
}

function buildProjectSignatureSource(snapshot: ProjectSessionSnapshot, snapshotRevision: string): string {
  return JSON.stringify({
    projectId: snapshot.projectId,
    snapshotRevision: normalizeText(snapshotRevision),
    provider: snapshot.provider,
    model: snapshot.model ?? "",
    isRunning: snapshot.isRunning,
    queuedCount: snapshot.queuedCount,
    activeConversationId: snapshot.activeConversationId ?? "",
    currentPromptPreview: truncateText(snapshot.currentPrompt, 240),
    latestMessagePreview: latestMessagePreview(snapshot),
    latestMessageRole: latestMessageRole(snapshot),
    latestActivityAt: latestActivityTimestamp(snapshot),
    queuePreview: snapshot.queue.slice(0, 3).map((entry) => ({
      runId: entry.runId,
      prompt: truncateText(entry.prompt, 160),
      source: entry.source,
      queuedAt: entry.queuedAt,
    })),
  });
}

export function createProjectSessionSignature(
  snapshot: ProjectSessionSnapshot,
  snapshotRevision: string,
): string {
  return createHash("sha1")
    .update(buildProjectSignatureSource(snapshot, snapshotRevision), "utf8")
    .digest("hex");
}
