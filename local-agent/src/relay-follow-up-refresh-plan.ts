export type RelayFollowUpRefreshStage = "catalog" | "catch-up" | "stabilize";

export interface RelayFollowUpRefreshPass {
  stage: RelayFollowUpRefreshStage;
  delayMs: number;
  reason: string;
  refreshProjectCatalog: boolean;
  refreshWorkgroupCatalog: boolean;
  syncProjects: boolean;
  syncWorkgroups: boolean;
}

export function buildRelayFollowUpRefreshPasses(
  baseReason: string,
  delaysMs: readonly number[],
  options: {
    includeImmediateCatalogPass?: boolean;
  } = {},
): RelayFollowUpRefreshPass[] {
  const passes: RelayFollowUpRefreshPass[] = [];
  if (options.includeImmediateCatalogPass) {
    passes.push({
      stage: "catalog",
      delayMs: 0,
      reason: baseReason,
      refreshProjectCatalog: true,
      refreshWorkgroupCatalog: true,
      syncProjects: false,
      syncWorkgroups: false,
    });
  }
  for (const delayMs of delaysMs) {
    const stage: RelayFollowUpRefreshStage = delayMs <= 300 ? "catch-up" : "stabilize";
    passes.push({
      stage,
      delayMs,
      reason: `${baseReason}:${delayMs}`,
      refreshProjectCatalog: true,
      refreshWorkgroupCatalog: true,
      syncProjects: true,
      syncWorkgroups: true,
    });
  }
  return passes;
}
