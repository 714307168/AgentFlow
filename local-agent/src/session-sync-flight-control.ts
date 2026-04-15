import type { CliProvider } from "./runtime-types";

export interface SessionSyncProjectUpdates {
  groupName?: string | null;
  cliProvider?: CliProvider;
  cliModel?: string | null;
  codexWebSearchEnabled?: boolean;
  projectPrompt?: string | null;
}

export interface SessionSyncRequestOptions {
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
  summaryOnly?: boolean;
  action?: string;
  conversationId?: string | null;
  itemId?: string | null;
  runId?: string | null;
  projectUpdates?: SessionSyncProjectUpdates | null;
}

function trimText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizePositiveNumber(value: number | null | undefined): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

export function isSessionSyncBackpressureEligible(options: SessionSyncRequestOptions = {}): boolean {
  if (normalizePositiveNumber(options.beforeSeq) > 0) {
    return false;
  }
  if (trimText(options.action)) {
    return false;
  }
  if (trimText(options.itemId)) {
    return false;
  }
  if (trimText(options.runId)) {
    return false;
  }
  if (options.projectUpdates && Object.keys(options.projectUpdates).length > 0) {
    return false;
  }
  return true;
}

export function mergeSessionSyncRequestOptions(
  current: SessionSyncRequestOptions,
  incoming: SessionSyncRequestOptions,
): SessionSyncRequestOptions {
  const currentAfterSeq = normalizePositiveNumber(current.afterSeq);
  const incomingAfterSeq = normalizePositiveNumber(incoming.afterSeq);
  let mergedAfterSeq = 0;
  if (currentAfterSeq > 0 && incomingAfterSeq > 0) {
    mergedAfterSeq = Math.min(currentAfterSeq, incomingAfterSeq);
  } else {
    mergedAfterSeq = currentAfterSeq || incomingAfterSeq;
  }

  const currentLimit = normalizePositiveNumber(current.limit);
  const incomingLimit = normalizePositiveNumber(incoming.limit);

  return {
    afterSeq: mergedAfterSeq > 0 ? mergedAfterSeq : undefined,
    limit: Math.max(currentLimit, incomingLimit) || undefined,
    summaryOnly: current.summaryOnly === true && incoming.summaryOnly === true,
    conversationId: trimText(incoming.conversationId) || trimText(current.conversationId) || undefined,
  };
}
