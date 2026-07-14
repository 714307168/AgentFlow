import type { RunSource, SessionActivity, SessionMessage } from "./runtime-types";

type WithMessages = Pick<{ messages: SessionMessage[] }, "messages">;
type WithActivities = Pick<{ activities: SessionActivity[] }, "activities">;
type WithQueue<T extends { source: RunSource }> = Pick<{ queue: T[] }, "queue">;
type WithCurrentSource = Pick<{ currentSource: RunSource | null }, "currentSource">;

/**
 * Project snapshots are private to the project workspace. Workgroup-origin
 * events remain available to collaboration views, but must not leak here.
 */
export function isProjectVisibleMessage(message: SessionMessage): boolean {
  return message.source !== "workgroup";
}

export function isProjectVisibleActivity(activity: SessionActivity): boolean {
  return activity.meta?.source !== "workgroup";
}

export function isProjectVisibleQueueEntry(entry: { source: RunSource }): boolean {
  return entry.source !== "workgroup";
}

export function getProjectVisibleCurrentSource(owner: WithCurrentSource): RunSource | null {
  return owner.currentSource === "workgroup" ? null : owner.currentSource;
}

export function getVisibleProjectMessages(owner: WithMessages): SessionMessage[] {
  return owner.messages.filter(isProjectVisibleMessage);
}

export function getVisibleProjectActivities(owner: WithActivities): SessionActivity[] {
  return owner.activities.filter(isProjectVisibleActivity);
}

export function getVisibleProjectQueue<T extends { source: RunSource }>(owner: WithQueue<T>): T[] {
  return owner.queue.filter(isProjectVisibleQueueEntry);
}
