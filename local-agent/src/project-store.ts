import Store from "electron-store";

export type ProjectCliProvider = "claude" | "codex";

export function normalizeProjectGroupName(rawValue: string | null | undefined): string | null {
  const normalized = String(rawValue ?? "").trim();
  return normalized || null;
}

interface Project {
  id: string;
  name: string;
  path: string;
  agentId: string;
  cliProvider: ProjectCliProvider;
  cliModel?: string | null;
  groupName?: string | null;
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
      groupName: normalizeProjectGroupName(project.groupName),
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
      groupName: normalizeProjectGroupName(project.groupName),
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
            groupName: updates.groupName !== undefined
              ? normalizeProjectGroupName(updates.groupName)
              : normalizeProjectGroupName(p.groupName),
          }
        : p
    );
    this.store.set("projects", projects);
  }
}

export { Project, ProjectStore };
export default new ProjectStore();
