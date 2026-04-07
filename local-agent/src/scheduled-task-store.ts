import Store from "electron-store";
import { v4 as uuidv4 } from "uuid";

export type ScheduledTaskScheduleType = "once" | "delay" | "interval" | "daily" | "weekly";
export type ScheduledTaskLastStatus = "idle" | "queued" | "running" | "success" | "error";
export type ScheduledTaskEventLevel = "info" | "error";

export interface ScheduledTaskEvent {
  id: string;
  runId?: string | null;
  level: ScheduledTaskEventLevel;
  message: string;
  createdAt: number;
  meta?: Record<string, string | number | boolean | null>;
}

export interface ScheduledTask {
  id: string;
  projectId: string;
  name: string;
  prompt: string;
  scheduleType: ScheduledTaskScheduleType;
  runAt?: number | null;
  delayMinutes?: number | null;
  delayStartAt?: number | null;
  intervalHours?: number | null;
  intervalStartAt?: number | null;
  dailyTime?: string | null;
  weeklyDay?: number | null;
  enabled: boolean;
  activeRunId?: string | null;
  lastRunAt?: number | null;
  lastRunStatus: ScheduledTaskLastStatus;
  lastError?: string | null;
  retryCount?: number | null;
  maxRetries?: number | null;
  retryDelayMinutes?: number | null;
  nextRunAt?: number | null;
  recentEvents?: ScheduledTaskEvent[];
  createdAt: number;
  updatedAt: number;
}

interface ScheduledTaskStoreSchema {
  tasks: ScheduledTask[];
}

const MAX_SCHEDULED_TASK_EVENTS = 20;

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
  if (value === "delay" || value === "interval" || value === "daily" || value === "weekly") {
    return value;
  }
  return "once";
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function normalizeRetryCount(value: number | null | undefined): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return 0;
  }
  return numeric;
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

export function normalizeWeeklyDay(value: number | null | undefined): number | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 6) {
    return null;
  }
  return numeric;
}

function normalizeLastStatus(value: string | null | undefined): ScheduledTaskLastStatus {
  switch (value) {
    case "queued":
    case "running":
    case "success":
    case "error":
      return value;
    default:
      return "idle";
  }
}

function normalizeEventLevel(value: string | null | undefined): ScheduledTaskEventLevel {
  return value === "error" ? "error" : "info";
}

function normalizeTaskEvent(event: ScheduledTaskEvent): ScheduledTaskEvent {
  const normalizedMessage = String(event.message ?? "").trim();
  return {
    id: String(event.id ?? "").trim() || uuidv4(),
    runId: normalizeNullableText(event.runId),
    level: normalizeEventLevel(event.level),
    message: normalizedMessage || "Scheduled task event",
    createdAt: normalizeTimestamp(event.createdAt) ?? Date.now(),
    meta: event.meta && typeof event.meta === "object"
      ? Object.fromEntries(
          Object.entries(event.meta)
            .filter(([key]) => String(key ?? "").trim())
            .map(([key, value]) => [String(key).trim(), value ?? null]),
        )
      : undefined,
  };
}

function normalizeTaskEvents(events: ScheduledTaskEvent[] | null | undefined): ScheduledTaskEvent[] {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }
  return events
    .filter((event): event is ScheduledTaskEvent => Boolean(event) && typeof event === "object")
    .map((event) => normalizeTaskEvent(event))
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_SCHEDULED_TASK_EVENTS);
}

export function computeScheduledTaskNextRunAt(
  task: Pick<ScheduledTask, "scheduleType" | "enabled" | "runAt" | "delayMinutes" | "delayStartAt" | "intervalHours" | "intervalStartAt" | "dailyTime" | "weeklyDay" | "lastRunAt">,
  now = Date.now(),
): number | null {
  if (!task.enabled) {
    return null;
  }

  const lastRunAt = normalizeTimestamp(task.lastRunAt);
  const scheduleType = normalizeScheduleType(task.scheduleType);
  if (scheduleType === "once") {
    const runAt = normalizeTimestamp(task.runAt);
    if (!runAt) {
      return null;
    }
    if (lastRunAt !== null && lastRunAt >= runAt) {
      return null;
    }
    return runAt;
  }

  if (scheduleType === "delay") {
    const delayMinutes = normalizePositiveInteger(task.delayMinutes);
    const delayStartAt = normalizeTimestamp(task.delayStartAt);
    if (!delayMinutes || !delayStartAt) {
      return null;
    }
    const runAt = delayStartAt + delayMinutes * 60 * 1000;
    if (lastRunAt !== null && lastRunAt >= runAt) {
      return null;
    }
    return runAt;
  }

  if (scheduleType === "interval") {
    const intervalHours = normalizePositiveInteger(task.intervalHours);
    const intervalStartAt = normalizeTimestamp(task.intervalStartAt);
    if (!intervalHours || !intervalStartAt) {
      return null;
    }
    if (lastRunAt !== null) {
      return lastRunAt + intervalHours * 60 * 60 * 1000;
    }
    return intervalStartAt + intervalHours * 60 * 60 * 1000;
  }

  const dailyTime = normalizeDailyTime(task.dailyTime);
  if (!dailyTime) {
    return null;
  }

  const [hour, minute] = dailyTime.split(":").map((value) => Number(value));
  const target = new Date(now);

  if (scheduleType === "weekly") {
    const weeklyDay = normalizeWeeklyDay(task.weeklyDay);
    if (weeklyDay === null) {
      return null;
    }
    const offsetDays = (weeklyDay - target.getDay() + 7) % 7;
    target.setDate(target.getDate() + offsetDays);
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= now || (lastRunAt !== null && lastRunAt >= target.getTime())) {
      target.setDate(target.getDate() + 7);
    }
    return target.getTime();
  }

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
        delayMinutes: normalizePositiveInteger(task.delayMinutes),
        delayStartAt: normalizeTimestamp(task.delayStartAt),
        intervalHours: normalizePositiveInteger(task.intervalHours),
        intervalStartAt: normalizeTimestamp(task.intervalStartAt),
        dailyTime: normalizeDailyTime(task.dailyTime),
        weeklyDay: normalizeWeeklyDay(task.weeklyDay),
        enabled: Boolean(task.enabled),
        activeRunId: normalizeNullableText(task.activeRunId),
        lastRunAt: normalizeTimestamp(task.lastRunAt),
        lastRunStatus: normalizeLastStatus(task.lastRunStatus),
        lastError: normalizeNullableText(task.lastError),
        retryCount: normalizeRetryCount(task.retryCount),
        maxRetries: normalizeRetryCount(task.maxRetries),
        retryDelayMinutes: normalizePositiveInteger(task.retryDelayMinutes),
        nextRunAt: normalizeTimestamp(task.nextRunAt),
        recentEvents: normalizeTaskEvents(task.recentEvents),
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
      delayMinutes: input.delayMinutes !== undefined ? normalizePositiveInteger(input.delayMinutes) : (existing?.delayMinutes ?? null),
      delayStartAt: input.delayStartAt !== undefined ? normalizeTimestamp(input.delayStartAt) : (existing?.delayStartAt ?? null),
      intervalHours: input.intervalHours !== undefined ? normalizePositiveInteger(input.intervalHours) : (existing?.intervalHours ?? null),
      intervalStartAt: input.intervalStartAt !== undefined ? normalizeTimestamp(input.intervalStartAt) : (existing?.intervalStartAt ?? null),
      dailyTime: input.dailyTime !== undefined ? normalizeDailyTime(input.dailyTime) : (existing?.dailyTime ?? null),
      weeklyDay: input.weeklyDay !== undefined ? normalizeWeeklyDay(input.weeklyDay) : (existing?.weeklyDay ?? null),
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : (existing?.enabled ?? true),
      activeRunId: input.activeRunId !== undefined ? normalizeNullableText(input.activeRunId) : (existing?.activeRunId ?? null),
      lastRunAt: input.lastRunAt !== undefined ? normalizeTimestamp(input.lastRunAt) : (existing?.lastRunAt ?? null),
      lastRunStatus: input.lastRunStatus !== undefined ? normalizeLastStatus(input.lastRunStatus) : (existing?.lastRunStatus ?? "idle"),
      lastError: input.lastError !== undefined ? normalizeNullableText(input.lastError) : (existing?.lastError ?? null),
      retryCount: input.retryCount !== undefined ? normalizeRetryCount(input.retryCount) : (existing?.retryCount ?? 0),
      maxRetries: input.maxRetries !== undefined ? normalizeRetryCount(input.maxRetries) : (existing?.maxRetries ?? 0),
      retryDelayMinutes: input.retryDelayMinutes !== undefined ? normalizePositiveInteger(input.retryDelayMinutes) : (existing?.retryDelayMinutes ?? 5),
      nextRunAt: input.nextRunAt !== undefined ? normalizeTimestamp(input.nextRunAt) : (existing?.nextRunAt ?? null),
      recentEvents: input.recentEvents !== undefined ? normalizeTaskEvents(input.recentEvents) : normalizeTaskEvents(existing?.recentEvents),
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

  appendEvent(
    taskId: string,
    event: Omit<ScheduledTaskEvent, "id" | "createdAt"> & { id?: string; createdAt?: number | null },
  ): ScheduledTask | null {
    const task = this.getTaskById(taskId);
    if (!task) {
      return null;
    }

    const nextEvent = normalizeTaskEvent({
      id: event.id ?? uuidv4(),
      runId: event.runId ?? null,
      level: event.level,
      message: event.message,
      createdAt: event.createdAt ?? Date.now(),
      meta: event.meta,
    });

    return this.saveTask({
      ...task,
      recentEvents: [nextEvent, ...(task.recentEvents ?? [])].slice(0, MAX_SCHEDULED_TASK_EVENTS),
    });
  }
}

export default new ScheduledTaskStore();
