import type { RelayConnectionState } from "./relay-client";

export type RelaySocketState =
  | "missing"
  | "connecting"
  | "open"
  | "closing"
  | "closed";

export type RelayRecoveryStage = "connect" | "auth" | "catch-up" | "stable";

export interface RelayHealthCheckDecisionInput {
  now: number;
  reason: string;
  staleTimeoutMs: number;
  connectionState: RelayConnectionState;
  socketState: RelaySocketState;
  isAuthenticated: boolean;
  lastInboundAt: number;
  lastSocketOpenAttemptAt: number;
  lastAuthenticatedAt: number;
  reconnectScheduled: boolean;
}

export interface RelayHealthCheckDecision {
  action: "none" | "connect" | "reconnect";
  stage: RelayRecoveryStage;
  staleForMs: number | null;
  detail: string;
}

const AUTHENTICATION_RECOVERY_GRACE_MS = 15_000;

export function decideRelayHealthCheckRecovery(
  input: RelayHealthCheckDecisionInput,
): RelayHealthCheckDecision {
  const stage = getRelayRecoveryStage(input);

  if (input.socketState === "missing") {
    return buildDecision(
      input,
      stage,
      input.reconnectScheduled ? "none" : "connect",
      null,
      input.reconnectScheduled ? "awaiting-scheduled-reconnect" : "missing-socket",
    );
  }

  if (input.socketState === "connecting") {
    const staleForMs = timeSince(input.now, input.lastSocketOpenAttemptAt);
    if (staleForMs > input.staleTimeoutMs) {
      return buildDecision(input, stage, "reconnect", staleForMs, "connecting-stalled");
    }
    return buildDecision(input, stage, "none", staleForMs, "connecting-grace");
  }

  if (input.socketState !== "open") {
    return buildDecision(
      input,
      stage,
      input.reconnectScheduled ? "none" : "reconnect",
      null,
      input.reconnectScheduled ? "awaiting-scheduled-reconnect" : "socket-not-open",
    );
  }

  if (!input.isAuthenticated) {
    const staleForMs = timeSince(input.now, input.lastSocketOpenAttemptAt);
    const authGraceMs = Math.min(input.staleTimeoutMs, AUTHENTICATION_RECOVERY_GRACE_MS);
    if (staleForMs > authGraceMs) {
      return buildDecision(input, stage, "reconnect", staleForMs, "authentication-stalled");
    }
    return buildDecision(input, stage, "none", staleForMs, "authentication-grace");
  }

  const staleSince = input.lastInboundAt > 0 ? input.lastInboundAt : input.lastAuthenticatedAt;
  const staleForMs = timeSince(input.now, staleSince || input.lastSocketOpenAttemptAt);
  if (staleForMs > input.staleTimeoutMs) {
    return buildDecision(input, stage, "reconnect", staleForMs, "inbound-stalled");
  }

  return buildDecision(input, stage, "none", staleForMs, stage === "catch-up" ? "catch-up-grace" : "healthy");
}

export function getRelayRecoveryStage(
  input: Pick<
    RelayHealthCheckDecisionInput,
    "connectionState" | "socketState" | "isAuthenticated" | "lastInboundAt" | "lastAuthenticatedAt"
  >,
): RelayRecoveryStage {
  if (
    input.socketState === "missing"
    || input.socketState === "connecting"
    || input.socketState === "closing"
    || input.socketState === "closed"
    || input.connectionState === "disconnected"
    || input.connectionState === "connecting"
    || input.connectionState === "reconnecting"
  ) {
    return "connect";
  }

  if (!input.isAuthenticated || input.connectionState === "authenticating") {
    return "auth";
  }

  if (input.lastAuthenticatedAt > 0 && input.lastInboundAt <= input.lastAuthenticatedAt) {
    return "catch-up";
  }

  return "stable";
}

function buildDecision(
  input: RelayHealthCheckDecisionInput,
  stage: RelayRecoveryStage,
  action: RelayHealthCheckDecision["action"],
  staleForMs: number | null,
  mode: string,
): RelayHealthCheckDecision {
  const detailParts = [
    "reason=" + input.reason,
    "mode=" + mode,
    "stage=" + stage,
    "state=" + input.connectionState,
    "socketState=" + input.socketState,
    "reconnectScheduled=" + String(input.reconnectScheduled),
  ];
  if (Number.isFinite(staleForMs)) {
    detailParts.push("staleForMs=" + String(staleForMs));
  }
  return {
    action,
    stage,
    staleForMs,
    detail: detailParts.join("; "),
  };
}

function timeSince(now: number, timestamp: number): number {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.max(0, now - timestamp);
}
