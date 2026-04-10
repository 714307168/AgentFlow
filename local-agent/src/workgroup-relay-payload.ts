import { createHash } from "crypto";

export interface WorkgroupRelayPayload<T = unknown> {
  agent_id: string;
  revision: string;
  workgroups: T[];
}

export interface WorkgroupListResponsePayload<T = unknown> extends WorkgroupRelayPayload<T> {
  changed: boolean;
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

export function buildWorkgroupListResponsePayload<T>(
  payload: WorkgroupRelayPayload<T>,
  knownRevision?: string | null,
): WorkgroupListResponsePayload<T> {
  const normalizedKnownRevision = knownRevision?.trim() ?? "";
  if (normalizedKnownRevision && normalizedKnownRevision === payload.revision) {
    return {
      agent_id: payload.agent_id,
      revision: payload.revision,
      changed: false,
      workgroups: [],
    };
  }

  return {
    agent_id: payload.agent_id,
    revision: payload.revision,
    changed: true,
    workgroups: payload.workgroups,
  };
}
