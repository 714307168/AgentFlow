export interface WorkgroupRegistryMembersQuery {
  groupNumber?: string | null;
  workgroupId?: string | null;
  hostAgentId?: string | null;
}

export interface NormalizedWorkgroupRegistryMembersQuery {
  groupNumber: string;
  workgroupId: string;
  hostAgentId: string;
}

export function normalizeWorkgroupRegistrySearchQuery(query: string | null | undefined): string {
  return String(query ?? "").trim();
}

export function normalizeWorkgroupRegistryMembersQuery(
  query: WorkgroupRegistryMembersQuery = {},
): NormalizedWorkgroupRegistryMembersQuery {
  return {
    groupNumber: String(query.groupNumber ?? "").trim(),
    workgroupId: String(query.workgroupId ?? "").trim(),
    hostAgentId: String(query.hostAgentId ?? "").trim(),
  };
}

export function createWorkgroupRegistryMembersCacheKey(query: WorkgroupRegistryMembersQuery = {}): string {
  return JSON.stringify(normalizeWorkgroupRegistryMembersQuery(query));
}

export function parseWorkgroupRegistryMembersCacheKey(cacheKey: string): NormalizedWorkgroupRegistryMembersQuery {
  const parsed = JSON.parse(String(cacheKey ?? "")) as Partial<NormalizedWorkgroupRegistryMembersQuery>;
  return normalizeWorkgroupRegistryMembersQuery(parsed);
}
