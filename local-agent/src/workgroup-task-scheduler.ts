import appLogger from "./app-logger";
import {
  computeScheduledTaskNextRunAt,
  isScheduledTaskDue,
} from "./scheduled-task-store";
import workgroupStore, { WorkgroupTask } from "./workgroup-store";

const SCHEDULER_POLL_INTERVAL_MS = 15_000;

interface WorkgroupTaskDispatchResult {
  success: boolean;
  error?: string;
}

interface WorkgroupTaskSchedulerConfig {
  dispatchTask: (taskId: string) => Promise<WorkgroupTaskDispatchResult>;
  shouldAutoStartReadOnlyTask?: (task: WorkgroupTask) => boolean;
  onTasksChanged?: () => void;
}

class WorkgroupTaskScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly inFlightTaskIds = new Set<string>();

  constructor(private readonly config: WorkgroupTaskSchedulerConfig) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.reconcileTasks("startup");
    void this.tick("startup");
    this.timer = setInterval(() => {
      void this.tick("poll");
    }, SCHEDULER_POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.inFlightTaskIds.clear();
  }

  syncTasks(reason = "manual-sync"): void {
    this.reconcileTasks(reason);
    void this.tick(reason);
  }

  private async tick(reason: string): Promise<void> {
    this.reconcileTasks(reason);
    const now = Date.now();
    const dueTasks = workgroupStore
      .listTasks()
      .filter((task) => this.isScheduledTask(task))
      .filter((task) => !this.inFlightTaskIds.has(task.id))
      .filter((task) => isScheduledTaskDue({
        enabled: task.scheduleEnabled !== false,
        nextRunAt: task.nextRunAt,
      }, now));
    const autoStartTasks = workgroupStore
      .listTasks()
      .filter((task) => !this.inFlightTaskIds.has(task.id))
      .filter((task) => this.config.shouldAutoStartReadOnlyTask?.(task) === true);

    for (const task of [...dueTasks, ...autoStartTasks]) {
      void this.executeTask(task, this.isScheduledTask(task) ? "scheduled" : "auto-research");
    }
  }

  private isScheduledTask(task: WorkgroupTask): boolean {
    return Boolean(task.scheduleType);
  }

  private computeNextRunAt(task: WorkgroupTask, lastDispatchAt = task.lastDispatchAt ?? null): number | null {
    if (!task.scheduleType) {
      return null;
    }
    return computeScheduledTaskNextRunAt({
      scheduleType: task.scheduleType,
      enabled: task.scheduleEnabled !== false,
      runAt: task.runAt,
      delayMinutes: task.delayMinutes,
      delayStartAt: task.delayStartAt,
      intervalHours: null,
      intervalStartAt: null,
      dailyTime: task.dailyTime,
      weeklyDay: task.weeklyDay,
      lastRunAt: lastDispatchAt,
    });
  }

  private buildTaskLogMeta(task: WorkgroupTask, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      taskId: task.id,
      workgroupId: task.workgroupId,
      assigneeMemberId: task.assigneeMemberId ?? null,
      dispatchProjectId: task.dispatchProjectId ?? null,
      dispatchRunId: task.dispatchRunId ?? null,
      status: task.status,
      scheduleType: task.scheduleType ?? null,
      scheduleEnabled: task.scheduleEnabled !== false,
      nextRunAt: task.nextRunAt ?? null,
      lastDispatchAt: task.lastDispatchAt ?? null,
      ...extra,
    };
  }

  private reconcileTasks(reason: string): void {
    let changed = false;
    for (const task of workgroupStore.listTasks()) {
      if (!this.isScheduledTask(task)) {
        if (task.nextRunAt === null || task.nextRunAt === undefined) {
          continue;
        }
        workgroupStore.saveTask({
          ...task,
          nextRunAt: null,
        });
        changed = true;
        continue;
      }

      let nextStatus = task.status;
      let nextDispatchRunId = task.dispatchRunId ?? null;
      let nextDispatchResult = task.lastDispatchResult ?? null;
      if ((task.status === "assigned" || task.status === "running") && !this.inFlightTaskIds.has(task.id)) {
        nextStatus = "error";
        nextDispatchRunId = null;
        nextDispatchResult = nextDispatchResult || "Desktop restarted before the scheduled workgroup task finished.";
      }

      const nextRunAt = this.computeNextRunAt(task);
      if (
        nextStatus === task.status
        && nextDispatchRunId === (task.dispatchRunId ?? null)
        && nextDispatchResult === (task.lastDispatchResult ?? null)
        && nextRunAt === (task.nextRunAt ?? null)
      ) {
        continue;
      }

      workgroupStore.saveTask({
        ...task,
        status: nextStatus,
        dispatchRunId: nextDispatchRunId,
        lastDispatchResult: nextDispatchResult,
        nextRunAt,
      });
      if (nextStatus === "error" && task.status !== "error") {
        appLogger.warn("scheduler", "Recovered scheduled workgroup task with stale in-flight state.", this.buildTaskLogMeta(task, {
          previousStatus: task.status,
          previousDispatchRunId: task.dispatchRunId ?? null,
          reason,
          recoveryState: "restart-residue",
          nextRunAt,
        }));
      }
      changed = true;
    }

    if (changed) {
      appLogger.info("scheduler", "Reconciled scheduled workgroup tasks.", { reason });
      this.config.onTasksChanged?.();
    }
  }

  private async executeTask(task: WorkgroupTask, trigger: "scheduled" | "manual" | "auto-research"): Promise<void> {
    const latestTask = workgroupStore.getTaskById(task.id);
    if (!latestTask || this.inFlightTaskIds.has(task.id)) {
      return;
    }

    this.inFlightTaskIds.add(task.id);
    appLogger.info("scheduler", "Queued scheduled workgroup task.", this.buildTaskLogMeta(latestTask, {
      trigger,
    }));

    try {
      const result = await this.config.dispatchTask(latestTask.id);
      const completedAt = Date.now();
      const persisted = workgroupStore.getTaskById(task.id) ?? latestTask;
      const nextRunAt = this.computeNextRunAt(persisted, persisted.lastDispatchAt ?? completedAt);
      const shouldDisable = (persisted.scheduleType === "once" || persisted.scheduleType === "delay") && nextRunAt === null;

      if (!result.success) {
        workgroupStore.saveTask({
          ...persisted,
          scheduleEnabled: shouldDisable ? false : persisted.scheduleEnabled !== false,
          status: "error",
          lastDispatchAt: persisted.lastDispatchAt ?? completedAt,
          lastDispatchResult: result.error || "Scheduled workgroup task dispatch failed.",
          nextRunAt,
        });
        appLogger.warn("scheduler", "Scheduled workgroup task failed.", this.buildTaskLogMeta(persisted, {
          trigger,
          error: result.error || "Scheduled workgroup task dispatch failed.",
          nextRunAt,
          disabled: shouldDisable,
        }));
      } else {
        workgroupStore.saveTask({
          ...persisted,
          scheduleEnabled: shouldDisable ? false : persisted.scheduleEnabled !== false,
          nextRunAt,
        });
        appLogger.info("scheduler", "Scheduled workgroup task dispatched.", this.buildTaskLogMeta(persisted, {
          trigger,
          nextRunAt,
          disabled: shouldDisable,
        }));
      }
    } finally {
      this.inFlightTaskIds.delete(task.id);
      this.config.onTasksChanged?.();
    }
  }
}

export default WorkgroupTaskScheduler;
