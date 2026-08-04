import { EventEmitter } from "events";
import { FieldNodeDiagnostics } from "./field-node-diagnostics";
import { FieldNodeProfile, normalizeFieldNodeProfile } from "./field-node-store";
import { Envelope, Events } from "./types";

export interface RemoteFieldNodeRecord {
  agentId: string;
  profile: FieldNodeProfile;
  online: boolean;
  updatedAt: number;
  diagnostics: FieldNodeDiagnostics | null;
}

export default class RemoteFieldNodeStore extends EventEmitter {
  private readonly nodes = new Map<string, RemoteFieldNodeRecord>();

  get(agentId: string): RemoteFieldNodeRecord | null {
    return this.nodes.get(agentId.trim()) ?? null;
  }

  list(): RemoteFieldNodeRecord[] {
    return [...this.nodes.values()].sort((a, b) => a.profile.displayName.localeCompare(b.profile.displayName));
  }

  handleEnvelope(env: Envelope): boolean {
    if (env.event !== Events.NODE_PROFILE && env.event !== Events.NODE_DIAGNOSTICS) return false;
    const payload = (env.payload ?? {}) as Record<string, unknown>;
    const agentId = String(payload.agent_id ?? env.agent_id ?? "").trim();
    if (!agentId) return true;
    const current = this.nodes.get(agentId);
    const rawProfile = (payload.profile && typeof payload.profile === "object"
      ? payload.profile
      : {}) as Record<string, unknown>;
    const profile = normalizeFieldNodeProfile({
      kind: rawProfile.kind as FieldNodeProfile["kind"],
      displayName: String(rawProfile.display_name ?? rawProfile.displayName ?? ""),
      location: rawProfile.location as string | null | undefined,
      diagnosticsEnabled: rawProfile.diagnostics_enabled !== false && rawProfile.diagnosticsEnabled !== false,
    });
    const next: RemoteFieldNodeRecord = {
      agentId,
      profile: profile.displayName ? profile : (current?.profile ?? profile),
      online: true,
      updatedAt: Date.now(),
      diagnostics: current?.diagnostics ?? null,
    };
    if (env.event === Events.NODE_DIAGNOSTICS && payload.diagnostics && typeof payload.diagnostics === "object") {
      next.diagnostics = payload.diagnostics as FieldNodeDiagnostics;
    }
    this.nodes.set(agentId, next);
    this.emit("changed", this.list());
    return true;
  }
}
