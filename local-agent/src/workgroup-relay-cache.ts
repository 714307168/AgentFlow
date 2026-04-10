import {
  buildWorkgroupRelayPayload,
  type WorkgroupRelayPayload,
} from "./workgroup-relay-payload";

interface WorkgroupRelayCacheSnapshot<T> {
  agentId: string;
  workgroups: T[];
  relayPayload: WorkgroupRelayPayload<T> | null;
}

export class WorkgroupRelayCache<T> {
  private snapshot: WorkgroupRelayCacheSnapshot<T> | null = null;

  get(agentId: string, loadWorkgroups: () => T[]): WorkgroupRelayCacheSnapshot<T> {
    const normalizedAgentId = agentId.trim();
    if (this.snapshot && this.snapshot.agentId === normalizedAgentId) {
      return this.snapshot;
    }

    const workgroups = loadWorkgroups();
    const nextSnapshot = {
      agentId: normalizedAgentId,
      workgroups,
      relayPayload: buildWorkgroupRelayPayload(normalizedAgentId, workgroups),
    };
    this.snapshot = nextSnapshot;
    return nextSnapshot;
  }

  invalidate(): void {
    this.snapshot = null;
  }
}
