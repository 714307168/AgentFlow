import Store from "electron-store";

export type ProjectCliProvider = "claude" | "codex";

export function normalizeProjectGroupName(rawValue: string | null | undefined): string | null {
  const normalized = String(rawValue ?? "").trim();
  return normalized || null;
}

export function normalizeCodexWebSearchEnabled(rawValue: unknown): boolean {
  return rawValue === true;
}

interface Project {
  id: string;
  name: string;
  path: string;
  agentId: string;
  cliProvider: ProjectCliProvider;
  cliModel?: string | null;
  codexWebSearchEnabled?: boolean;
  groupName?: string | null;
  projectPrompt?: string | null;
  createdAt: number;
}

interface StoreSchema {
  projects: Project[];
}

class ProjectStore {
  private store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({
      defaults: { projects: [] },
    });
  }

  add(project: Project): void {
    const projects = this.getAll();
    projects.push({
      ...project,
      codexWebSearchEnabled: normalizeCodexWebSearchEnabled(project.codexWebSearchEnabled),
      groupName: normalizeProjectGroupName(project.groupName),
      projectPrompt: typeof project.projectPrompt === "string" ? project.projectPrompt.trim() || null : null,
    });
    this.store.set("projects", projects);
  }

  remove(id: string): void {
    const projects = this.getAll().filter((p) => p.id !== id);
    this.store.set("projects", projects);
  }

  getAll(): Project[] {
    return this.store.get("projects", []).map((project) => ({
      ...project,
      codexWebSearchEnabled: normalizeCodexWebSearchEnabled(project.codexWebSearchEnabled),
      groupName: normalizeProjectGroupName(project.groupName),
      projectPrompt: typeof project.projectPrompt === "string" ? project.projectPrompt.trim() || null : null,
    }));
  }

  getById(id: string): Project | undefined {
    return this.getAll().find((p) => p.id === id);
  }

  update(id: string, updates: Partial<Project>): void {
    const projects = this.getAll().map((p) =>
      p.id === id
        ? {
            ...p,
            ...updates,
            codexWebSearchEnabled: updates.codexWebSearchEnabled !== undefined
              ? normalizeCodexWebSearchEnabled(updates.codexWebSearchEnabled)
              : normalizeCodexWebSearchEnabled(p.codexWebSearchEnabled),
            groupName: updates.groupName !== undefined
              ? normalizeProjectGroupName(updates.groupName)
              : normalizeProjectGroupName(p.groupName),
            projectPrompt: updates.projectPrompt !== undefined
              ? (typeof updates.projectPrompt === "string" ? updates.projectPrompt.trim() || null : null)
              : (typeof p.projectPrompt === "string" ? p.projectPrompt.trim() || null : null),
          }
        : p
    );
    this.store.set("projects", projects);
  }
}

export { Project, ProjectStore };
export default new ProjectStore();
