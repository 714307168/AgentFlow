import { createHash } from "crypto";

export interface WorkgroupRelayPayload<T = unknown> {
  agent_id: string;
  revision: string;
  workgroups: T[];
}

export function createWorkgroupRelayRevision(workgroups: unknown[]): string {
  return createHash("sha1")
    .update(JSON.stringify(workgroups), "utf8")
    .digest("hex");
}

export function buildWorkgroupRelayPayload<T>(
  agentId: string,
  workgroups: T[],
): WorkgroupRelayPayload<T> | null {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) {
    return null;
  }

  return {
    agent_id: normalizedAgentId,
    revision: createWorkgroupRelayRevision(workgroups),
    workgroups,
  };
}
