import type { ProjectSessionSnapshot, ProjectSyncBucket } from "./runtime-types";

export const PROJECT_SYNC_BUCKET_HOT_AGE_MS = 15 * 60 * 1000;
export const PROJECT_SYNC_BUCKET_WARM_AGE_MS = 2 * 60 * 60 * 1000;
export const PROJECT_SYNC_BUCKET_COLD_AGE_MS = 24 * 60 * 60 * 1000;

function conversationActivityAt(snapshot: ProjectSessionSnapshot): number {
  return snapshot.conversations.reduce(
    (latest, conversation) => Math.max(latest, conversation.updatedAt, conversation.createdAt),
    0,
  );
}

function messageActivityAt(snapshot: ProjectSessionSnapshot): number {
  return snapshot.messages.reduce(
    (latest, message) => Math.max(latest, message.updatedAt, message.createdAt),
    0,
  );
}

function activityStreamAt(snapshot: ProjectSessionSnapshot): number {
  return snapshot.activities.reduce(
    (latest, activity) => Math.max(latest, activity.updatedAt, activity.createdAt),
    0,
  );
}

function cliStreamAt(snapshot: ProjectSessionSnapshot): number {
  return snapshot.cliTrace.reduce(
    (latest, entry) => Math.max(latest, entry.createdAt),
    0,
  );
}

function queueActivityAt(snapshot: ProjectSessionSnapshot): number {
  return snapshot.queue.reduce(
    (latest, entry) => Math.max(latest, entry.queuedAt),
    0,
  );
}

export function resolveProjectSessionLastChangedAt(snapshot: ProjectSessionSnapshot): number {
  return Math.max(
    snapshot.currentStartedAt ?? 0,
    conversationActivityAt(snapshot),
    messageActivityAt(snapshot),
    activityStreamAt(snapshot),
    cliStreamAt(snapshot),
    queueActivityAt(snapshot),
  );
}

export function createProjectSyncBucket(
  snapshot: ProjectSessionSnapshot,
  nowMs: number = Date.now(),
): ProjectSyncBucket {
  if (snapshot.isRunning || snapshot.queuedCount > 0) {
    return "hot";
  }

  const lastChangedAt = resolveProjectSessionLastChangedAt(snapshot);
  if (lastChangedAt <= 0 || nowMs <= lastChangedAt) {
    return "hot";
  }

  const ageMs = nowMs - lastChangedAt;
  if (ageMs <= PROJECT_SYNC_BUCKET_HOT_AGE_MS) {
    return "hot";
  }
  if (ageMs <= PROJECT_SYNC_BUCKET_WARM_AGE_MS) {
    return "warm";
  }
  if (ageMs <= PROJECT_SYNC_BUCKET_COLD_AGE_MS) {
    return "cold";
  }
  return "dormant";
}
