export type RemoteProjectSyncDetailMode = "auto" | "full" | "summary";

export function shouldUseSummaryOnlyProjectSync(options: {
  projectId: string | null | undefined;
  activeProjectId?: string | null | undefined;
  detailMode?: RemoteProjectSyncDetailMode | null | undefined;
}): boolean {
  const projectId = String(options.projectId ?? "").trim();
  if (!projectId) {
    return false;
  }

  const detailMode = options.detailMode ?? "auto";
  if (detailMode === "full") {
    return false;
  }
  if (detailMode === "summary") {
    return true;
  }

  const activeProjectId = String(options.activeProjectId ?? "").trim();
  return activeProjectId.length > 0 && activeProjectId !== projectId;
}
