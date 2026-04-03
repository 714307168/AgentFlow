import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";

export type ScheduledTaskScheduleType = "once" | "daily";
export type ScheduledTaskLastStatus = "idle" | "queued" | "success" | "error";

export interface ScheduledTask {
  id: string;
  projectId: string;
  name: string;
  prompt: string;
  scheduleType: ScheduledTaskScheduleType;
  runAt?: number | null;
  dailyTime?: string | null;
  enabled: boolean;
  lastRunAt?: number | null;
  lastRunStatus: ScheduledTaskLastStatus;
  lastError?: string | null;
  nextRunAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ScheduledTaskStoreSchema {
  tasks: ScheduledTask[];
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeTimestamp(value: number | null | undefined): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.trunc(numeric);
}

function normalizeScheduleType(value: string | null | undefined): ScheduledTaskScheduleType {
  return value === "daily" ? "daily" : "once";
}

export function normalizeDailyTime(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeLastStatus(value: string | null | undefined): ScheduledTaskLastStatus {
  switch (value) {
    case "queued":
    case "success":
    case "error":
      return value;
    default:
      return "idle";
  }
}

export function computeScheduledTaskNextRunAt(
  task: Pick<ScheduledTask, "scheduleType" | "enabled" | "runAt" | "dailyTime" | "lastRunAt">,
  now = Date.now(),
): number | null {
  if (!task.enabled) {
    return null;
  }

  const lastRunAt = normalizeTimestamp(task.lastRunAt);
  if (normalizeScheduleType(task.scheduleType) === "once") {
    const runAt = normalizeTimestamp(task.runAt);
    if (!runAt) {
      return null;
    }
    if (lastRunAt !== null && lastRunAt >= runAt) {
      return null;
    }
    return runAt;
  }

  const dailyTime = normalizeDailyTime(task.dailyTime);
  if (!dailyTime) {
    return null;
  }

  const [hour, minute] = dailyTime.split(":").map((value) => Number(value));
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (lastRunAt !== null && lastRunAt >= target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

export function isScheduledTaskDue(task: Pick<ScheduledTask, "enabled" | "nextRunAt">, now = Date.now()): boolean {
  const nextRunAt = normalizeTimestamp(task.nextRunAt);
  return Boolean(task.enabled && nextRunAt !== null && nextRunAt <= now);
}

class ScheduledTaskStore {
  private readonly store = new Store<ScheduledTaskStoreSchema>({
    name: "scheduled-tasks",
    defaults: {
      tasks: [],
    },
  });

  listTasks(): ScheduledTask[] {
    return this.store.get("tasks", [])
      .map((task) => ({
        ...task,
        projectId: String(task.projectId ?? "").trim(),
        name: String(task.name ?? "").trim(),
        prompt: String(task.prompt ?? "").trim(),
        scheduleType: normalizeScheduleType(task.scheduleType),
        runAt: normalizeTimestamp(task.runAt),
        dailyTime: normalizeDailyTime(task.dailyTime),
        enabled: Boolean(task.enabled),
        lastRunAt: normalizeTimestamp(task.lastRunAt),
        lastRunStatus: normalizeLastStatus(task.lastRunStatus),
        lastError: normalizeNullableText(task.lastError),
        nextRunAt: normalizeTimestamp(task.nextRunAt),
        createdAt: normalizeTimestamp(task.createdAt) ?? Date.now(),
        updatedAt: normalizeTimestamp(task.updatedAt) ?? Date.now(),
      }))
      .sort((left, right) => {
        const leftRank = left.nextRunAt ?? Number.MAX_SAFE_INTEGER;
        const rightRank = right.nextRunAt ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return right.updatedAt - left.updatedAt;
      });
  }

  getTaskById(id: string): ScheduledTask | undefined {
    return this.listTasks().find((task) => task.id === id);
  }

  saveTask(
    input: Partial<ScheduledTask> & {
      id?: string;
      projectId: string;
      name: string;
      prompt: string;
      scheduleType: ScheduledTaskScheduleType;
    },
  ): ScheduledTask {
    const tasks = this.listTasks();
    const now = Date.now();
    const existingIndex = input.id ? tasks.findIndex((task) => task.id === input.id) : -1;
    const existing = existingIndex >= 0 ? tasks[existingIndex] : null;
    const next: ScheduledTask = {
      id: existing?.id || input.id?.trim() || uuidv4(),
      projectId: String(input.projectId ?? "").trim(),
      name: String(input.name ?? "").trim(),
      prompt: String(input.prompt ?? "").trim(),
      scheduleType: normalizeScheduleType(input.scheduleType),
      runAt: input.runAt !== undefined ? normalizeTimestamp(input.runAt) : (existing?.runAt ?? null),
      dailyTime: input.dailyTime !== undefined ? normalizeDailyTime(input.dailyTime) : (existing?.dailyTime ?? null),
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : (existing?.enabled ?? true),
      lastRunAt: input.lastRunAt !== undefined ? normalizeTimestamp(input.lastRunAt) : (existing?.lastRunAt ?? null),
      lastRunStatus: input.lastRunStatus !== undefined ? normalizeLastStatus(input.lastRunStatus) : (existing?.lastRunStatus ?? "idle"),
      lastError: input.lastError !== undefined ? normalizeNullableText(input.lastError) : (existing?.lastError ?? null),
      nextRunAt: input.nextRunAt !== undefined ? normalizeTimestamp(input.nextRunAt) : (existing?.nextRunAt ?? null),
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
    this.store.set("tasks", this.listTasks().filter((task) => task.id !== id));
  }

  removeTasksByProjectId(projectId: string): void {
    this.store.set("tasks", this.listTasks().filter((task) => task.projectId !== projectId));
  }
}

export default new ScheduledTaskStore();
