import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";
import {
  normalizeDailyTime,
  normalizeWeeklyDay,
  ScheduledTaskScheduleType,
} from "./scheduled-task-store";

export type WorkgroupRole = "member" | "project_manager";
export type WorkgroupMode = "swarm";
export type WorkgroupMemberExecutionMode = "read" | "write";
export type WorkgroupMemberSpecialty = "planner" | "implementer" | "reviewer" | "tester" | "researcher" | "general";
export type WorkgroupTaskPriority = "low" | "normal" | "high";
export type WorkgroupTaskStatus = "todo" | "assigned" | "running" | "blocked" | "done" | "error";
export type WorkgroupMemberKind = "project" | "pm";

export interface Workgroup {
  id: string;
  name: string;
  description?: string | null;
  allowDirectMemberMessages: boolean;
  groupNumber?: string | null;
  planWorkspacePath?: string | null;
  registryUpdatedAt?: number | null;
  mode: WorkgroupMode;
  swarmSchemaVersion: 2;
  requireWriteApproval: boolean;
  singleWriterPerWorkspace: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkgroupMember {
  id: string;
  workgroupId: string;
  name: string;
  role: WorkgroupRole;
  kind?: WorkgroupMemberKind | null;
  projectId?: string | null;
  projectName?: string | null;
  projectPath?: string | null;
  projectKind?: "local" | "remote" | null;
  allowedPaths: string[];
  systemPrompt?: string | null;
  executionMode: WorkgroupMemberExecutionMode;
  specialty: WorkgroupMemberSpecialty;
  createdAt: number;
  updatedAt: number;
}

export interface WorkgroupTask {
  id: string;
  workgroupId: string;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  dependsOnIds: string[];
  assigneeMemberId?: string | null;
  priority: WorkgroupTaskPriority;
  status: WorkgroupTaskStatus;
  scheduleType?: ScheduledTaskScheduleType | null;
  scheduleEnabled?: boolean;
  runAt?: number | null;
  delayMinutes?: number | null;
  delayStartAt?: number | null;
  dailyTime?: string | null;
  weeklyDay?: number | null;
  nextRunAt?: number | null;
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

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.trunc(numeric);
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function normalizeScheduleType(value: string | null | undefined): ScheduledTaskScheduleType | null {
  if (value === "once" || value === "delay" || value === "daily" || value === "weekly") {
    return value;
  }
  return null;
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

function normalizeMemberKind(value: string | null | undefined): WorkgroupMemberKind {
  return value === "pm" ? "pm" : "project";
}

function normalizeWorkgroupRole(
  value: string | null | undefined,
  kind: WorkgroupMemberKind,
): WorkgroupRole {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (kind === "pm" || normalized === "project_manager" || normalized === "pm") {
    return "project_manager";
  }
  return "member";
}

function normalizeExecutionMode(value: unknown): WorkgroupMemberExecutionMode {
  return value === "write" ? "write" : "read";
}

function normalizeSpecialty(value: unknown): WorkgroupMemberSpecialty {
  switch (value) {
    case "planner":
    case "implementer":
    case "reviewer":
    case "tester":
    case "researcher":
      return value;
    default:
      return "general";
  }
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
    const stored = this.store.get("workgroups", []);
    const workgroups = stored.map((workgroup) => this.normalizeWorkgroup(workgroup));
    if (stored.some((workgroup, index) => workgroup.mode !== "swarm" || workgroup.swarmSchemaVersion !== 2 || JSON.stringify(workgroup) !== JSON.stringify(workgroups[index]))) {
      this.store.set("workgroups", workgroups);
    }
    return workgroups;
  }

  private normalizeWorkgroup(workgroup: Partial<Workgroup>): Workgroup {
    return {
      ...workgroup,
      id: String(workgroup.id ?? "").trim(),
      name: String(workgroup.name ?? "").trim(),
      description: normalizeNullableText(workgroup.description),
      allowDirectMemberMessages: Boolean(workgroup.allowDirectMemberMessages),
      groupNumber: normalizeNullableText(workgroup.groupNumber),
      planWorkspacePath: normalizeNullableText(workgroup.planWorkspacePath),
      registryUpdatedAt: workgroup.registryUpdatedAt ? Number(workgroup.registryUpdatedAt) : null,
      // All legacy workgroups are intentionally upgraded to the swarm model.
      mode: "swarm",
      swarmSchemaVersion: 2,
      requireWriteApproval: workgroup.requireWriteApproval !== false,
      singleWriterPerWorkspace: workgroup.singleWriterPerWorkspace !== false,
      createdAt: Number(workgroup.createdAt) || Date.now(),
      updatedAt: Number(workgroup.updatedAt) || Date.now(),
    };
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
      groupNumber: input.groupNumber !== undefined
        ? normalizeNullableText(input.groupNumber)
        : (workgroups[existingIndex]?.groupNumber ?? null),
      planWorkspacePath: input.planWorkspacePath !== undefined
        ? normalizeNullableText(input.planWorkspacePath)
        : (workgroups[existingIndex]?.planWorkspacePath ?? null),
      registryUpdatedAt: input.registryUpdatedAt !== undefined
        ? (input.registryUpdatedAt ? Number(input.registryUpdatedAt) : null)
        : (workgroups[existingIndex]?.registryUpdatedAt ?? null),
      mode: "swarm",
      swarmSchemaVersion: 2,
      requireWriteApproval: input.requireWriteApproval !== undefined
        ? input.requireWriteApproval !== false
        : (workgroups[existingIndex]?.requireWriteApproval ?? true),
      singleWriterPerWorkspace: input.singleWriterPerWorkspace !== undefined
        ? input.singleWriterPerWorkspace !== false
        : (workgroups[existingIndex]?.singleWriterPerWorkspace ?? true),
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
    const members = this.store.get("members", []).map((member) => {
      const kind = normalizeMemberKind(member.kind);
      return {
        ...member,
        role: normalizeWorkgroupRole((member as Partial<WorkgroupMember>).role, kind),
        kind,
        projectId: normalizeNullableText(member.projectId),
        projectName: normalizeNullableText(member.projectName),
        projectPath: normalizeNullableText(member.projectPath),
        projectKind: normalizeProjectKind(member.projectKind),
        systemPrompt: normalizeNullableText(member.systemPrompt),
        executionMode: normalizeExecutionMode(member.executionMode),
        specialty: normalizeSpecialty(member.specialty),
        allowedPaths: normalizeAllowedPaths(member.allowedPaths),
      };
    });
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
    const kind = normalizeMemberKind(input.kind ?? existing?.kind);
    const next: WorkgroupMember = {
      id: existing?.id || input.id?.trim() || uuidv4(),
      workgroupId: input.workgroupId,
      name: input.name.trim(),
      role: normalizeWorkgroupRole(input.role ?? existing?.role, kind),
      kind,
      projectId: normalizeNullableText(input.projectId),
      projectName: normalizeNullableText(input.projectName),
      projectPath: normalizeNullableText(input.projectPath),
      projectKind: normalizeProjectKind(input.projectKind),
      allowedPaths: normalizeAllowedPaths(input.allowedPaths),
      systemPrompt: normalizeNullableText(input.systemPrompt),
      executionMode: normalizeExecutionMode(input.executionMode ?? existing?.executionMode),
      specialty: normalizeSpecialty(input.specialty ?? existing?.specialty),
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
      dependsOnIds: normalizeIdList(task.dependsOnIds),
      assigneeMemberId: normalizeNullableText(task.assigneeMemberId),
      scheduleType: normalizeScheduleType(task.scheduleType),
      scheduleEnabled: task.scheduleEnabled !== false,
      runAt: normalizeTimestamp(task.runAt),
      delayMinutes: normalizePositiveInteger(task.delayMinutes),
      delayStartAt: normalizeTimestamp(task.delayStartAt),
      dailyTime: normalizeDailyTime(task.dailyTime),
      weeklyDay: normalizeWeeklyDay(task.weeklyDay),
      nextRunAt: normalizeTimestamp(task.nextRunAt),
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
      dependsOnIds: input.dependsOnIds !== undefined
        ? normalizeIdList(input.dependsOnIds)
        : (existing?.dependsOnIds ?? []),
      assigneeMemberId: normalizeNullableText(input.assigneeMemberId),
      priority: input.priority === "low" || input.priority === "high" ? input.priority : "normal",
      status: input.status ?? existing?.status ?? "todo",
      scheduleType: input.scheduleType !== undefined
        ? normalizeScheduleType(input.scheduleType)
        : (existing?.scheduleType ?? null),
      scheduleEnabled: input.scheduleEnabled !== undefined ? input.scheduleEnabled !== false : (existing?.scheduleEnabled ?? true),
      runAt: input.runAt !== undefined ? normalizeTimestamp(input.runAt) : (existing?.runAt ?? null),
      delayMinutes: input.delayMinutes !== undefined ? normalizePositiveInteger(input.delayMinutes) : (existing?.delayMinutes ?? null),
      delayStartAt: input.delayStartAt !== undefined ? normalizeTimestamp(input.delayStartAt) : (existing?.delayStartAt ?? null),
      dailyTime: input.dailyTime !== undefined ? normalizeDailyTime(input.dailyTime) : (existing?.dailyTime ?? null),
      weeklyDay: input.weeklyDay !== undefined ? normalizeWeeklyDay(input.weeklyDay) : (existing?.weeklyDay ?? null),
      nextRunAt: input.nextRunAt !== undefined ? normalizeTimestamp(input.nextRunAt) : (existing?.nextRunAt ?? null),
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
    this.store.set("tasks", this.listTasks()
      .filter((entry) => entry.id !== id)
      .map((entry) => entry.dependsOnIds.includes(id) ? {
        ...entry,
        dependsOnIds: entry.dependsOnIds.filter((dependencyId) => dependencyId !== id),
        updatedAt: Date.now(),
      } : entry));
  }
}

export default new WorkgroupStore();
