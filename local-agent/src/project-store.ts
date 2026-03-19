import Store from "electron-store";

export type ProjectCliProvider = "claude" | "codex";

interface Project {
  id: string;
  name: string;
  path: string;
  agentId: string;
  cliProvider: ProjectCliProvider;
  cliModel?: string | null;
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
    projects.push(project);
    this.store.set("projects", projects);
  }

  remove(id: string): void {
    const projects = this.getAll().filter((p) => p.id !== id);
    this.store.set("projects", projects);
  }

  getAll(): Project[] {
    return this.store.get("projects", []);
  }

  getById(id: string): Project | undefined {
    return this.getAll().find((p) => p.id === id);
  }

  update(id: string, updates: Partial<Project>): void {
    const projects = this.getAll().map((p) =>
      p.id === id ? { ...p, ...updates } : p
    );
    this.store.set("projects", projects);
  }
}

export { Project, ProjectStore };
export default new ProjectStore();
