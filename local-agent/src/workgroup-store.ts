import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";

export type WorkgroupRole = "developer" | "qa" | "project_manager" | "custom";
export type WorkgroupTaskPriority = "low" | "normal" | "high";
export type WorkgroupTaskStatus = "todo" | "assigned" | "running" | "blocked" | "done" | "error";

export interface Workgroup {
  id: string;
  name: string;
  description?: string | null;
  allowDirectMemberMessages: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkgroupMember {
  id: string;
  workgroupId: string;
  name: string;
  role: WorkgroupRole;
  projectId?: string | null;
  projectName?: string | null;
  projectPath?: string | null;
  projectKind?: "local" | "remote" | null;
  allowedPaths: string[];
  systemPrompt?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkgroupTask {
  id: string;
  workgroupId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  assigneeMemberId?: string | null;
  priority: WorkgroupTaskPriority;
  status: WorkgroupTaskStatus;
  dispatchProjectId?: string | null;
  dispatchRunId?: string | null;
  lastDispatchAt?: number | null;
  lastDispatchResult?: string | null;
  createdAt: number;
  updatedAt: number;
}

interface WorkgroupStoreSchema {
  workgroups: Workgroup[];
  members: WorkgroupMember[];
  tasks: WorkgroupTask[];
}

function normalizeProjectKind(value: string | null | undefined): "local" | "remote" | null {
  if (value === "local" || value === "remote") {
    return value;
  }
  return null;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeAllowedPaths(paths: Array<string | null | undefined> | null | undefined): string[] {
  if (!Array.isArray(paths)) {
    return [];
  }
  return Array.from(
    new Set(
      paths
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean),
    ),
  );
}

class WorkgroupStore {
  private readonly store = new Store<WorkgroupStoreSchema>({
    name: "workgroups",
    defaults: {
      workgroups: [],
      members: [],
      tasks: [],
    },
  });

  listWorkgroups(): Workgroup[] {
    return this.store.get("workgroups", []).map((workgroup) => ({
      ...workgroup,
      description: normalizeNullableText(workgroup.description),
    }));
  }

  getWorkgroupById(id: string): Workgroup | undefined {
    return this.listWorkgroups().find((entry) => entry.id === id);
  }

  saveWorkgroup(input: Partial<Workgroup> & { id?: string; name: string }): Workgroup {
    const workgroups = this.listWorkgroups();
    const now = Date.now();
    const existingIndex = input.id ? workgroups.findIndex((entry) => entry.id === input.id) : -1;
    const next: Workgroup = {
      id: existingIndex >= 0 ? workgroups[existingIndex].id : (input.id?.trim() || uuidv4()),
      name: input.name.trim(),
      description: normalizeNullableText(input.description),
      allowDirectMemberMessages: Boolean(input.allowDirectMemberMessages),
      createdAt: existingIndex >= 0 ? workgroups[existingIndex].createdAt : now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      workgroups[existingIndex] = next;
    } else {
      workgroups.push(next);
    }
    this.store.set("workgroups", workgroups);
    return next;
  }

  removeWorkgroup(id: string): void {
    this.store.set("workgroups", this.listWorkgroups().filter((entry) => entry.id !== id));
    this.store.set("members", this.listMembers().filter((entry) => entry.workgroupId !== id));
    this.store.set("tasks", this.listTasks().filter((entry) => entry.workgroupId !== id));
  }

  listMembers(workgroupId?: string | null): WorkgroupMember[] {
    const members = this.store.get("members", []).map((member) => ({
      ...member,
      projectId: normalizeNullableText(member.projectId),
      projectName: normalizeNullableText(member.projectName),
      projectPath: normalizeNullableText(member.projectPath),
      projectKind: normalizeProjectKind(member.projectKind),
      systemPrompt: normalizeNullableText(member.systemPrompt),
      allowedPaths: normalizeAllowedPaths(member.allowedPaths),
    }));
    if (!workgroupId) {
      return members;
    }
    return members.filter((entry) => entry.workgroupId === workgroupId);
  }

  getMemberById(id: string): WorkgroupMember | undefined {
    return this.listMembers().find((entry) => entry.id === id);
  }

  saveMember(input: Partial<WorkgroupMember> & { id?: string; workgroupId: string; name: string; role: WorkgroupRole }): WorkgroupMember {
    const members = this.listMembers();
    const now = Date.now();
    const existingIndex = input.id ? members.findIndex((entry) => entry.id === input.id) : -1;
    const existing = existingIndex >= 0 ? members[existingIndex] : null;
    const next: WorkgroupMember = {
      id: existing?.id || input.id?.trim() || uuidv4(),
      workgroupId: input.workgroupId,
      name: input.name.trim(),
      role: input.role,
      projectId: normalizeNullableText(input.projectId),
      projectName: normalizeNullableText(input.projectName),
      projectPath: normalizeNullableText(input.projectPath),
      projectKind: normalizeProjectKind(input.projectKind),
      allowedPaths: normalizeAllowedPaths(input.allowedPaths),
      systemPrompt: normalizeNullableText(input.systemPrompt),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existingIndex >= 0) {
      members[existingIndex] = next;
    } else {
      members.push(next);
    }
    this.store.set("members", members);
    return next;
  }

  removeMember(id: string): void {
    this.store.set("members", this.listMembers().filter((entry) => entry.id !== id));
    const tasks = this.listTasks().map((task) => task.assigneeMemberId === id ? {
      ...task,
      assigneeMemberId: null,
      updatedAt: Date.now(),
    } : task);
    this.store.set("tasks", tasks);
  }

  listTasks(workgroupId?: string | null): WorkgroupTask[] {
    const tasks = this.store.get("tasks", []).map((task) => ({
      ...task,
      description: normalizeNullableText(task.description),
      acceptanceCriteria: normalizeNullableText(task.acceptanceCriteria),
      assigneeMemberId: normalizeNullableText(task.assigneeMemberId),
      dispatchProjectId: normalizeNullableText(task.dispatchProjectId),
      dispatchRunId: normalizeNullableText(task.dispatchRunId),
      lastDispatchResult: normalizeNullableText(task.lastDispatchResult),
      lastDispatchAt: task.lastDispatchAt ? Number(task.lastDispatchAt) : null,
    }));
    if (!workgroupId) {
      return tasks;
    }
    return tasks.filter((entry) => entry.workgroupId === workgroupId);
  }

  getTaskById(id: string): WorkgroupTask | undefined {
    return this.listTasks().find((entry) => entry.id === id);
  }

  saveTask(
    input: Partial<WorkgroupTask> & {
      id?: string;
      workgroupId: string;
      title: string;
    },
  ): WorkgroupTask {
    const tasks = this.listTasks();
    const now = Date.now();
    const existingIndex = input.id ? tasks.findIndex((entry) => entry.id === input.id) : -1;
    const existing = existingIndex >= 0 ? tasks[existingIndex] : null;
    const next: WorkgroupTask = {
      id: existing?.id || input.id?.trim() || uuidv4(),
      workgroupId: input.workgroupId,
      title: input.title.trim(),
      description: normalizeNullableText(input.description),
      acceptanceCriteria: normalizeNullableText(input.acceptanceCriteria),
      assigneeMemberId: normalizeNullableText(input.assigneeMemberId),
      priority: input.priority === "low" || input.priority === "high" ? input.priority : "normal",
      status: input.status ?? existing?.status ?? "todo",
      dispatchProjectId: input.dispatchProjectId !== undefined
        ? normalizeNullableText(input.dispatchProjectId)
        : (existing?.dispatchProjectId ?? null),
      dispatchRunId: input.dispatchRunId !== undefined
        ? normalizeNullableText(input.dispatchRunId)
        : (existing?.dispatchRunId ?? null),
      lastDispatchAt: input.lastDispatchAt !== undefined ? (input.lastDispatchAt ? Number(input.lastDispatchAt) : null) : (existing?.lastDispatchAt ?? null),
      lastDispatchResult: input.lastDispatchResult !== undefined ? normalizeNullableText(input.lastDispatchResult) : (existing?.lastDispatchResult ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existingIndex >= 0) {
      tasks[existingIndex] = next;
    } else {
      tasks.push(next);
    }
    this.store.set("tasks", tasks);
    return next;
  }

  removeTask(id: string): void {
    this.store.set("tasks", this.listTasks().filter((entry) => entry.id !== id));
  }
}

export default new WorkgroupStore();
