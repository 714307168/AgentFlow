import appLogger from "./app-logger";
import { v4 as uuidv4 } from "uuid";
import scheduledTaskStore, {
  computeScheduledTaskNextRunAt,
  isScheduledTaskDue,
  ScheduledTask,
} from "./scheduled-task-store";

const SCHEDULER_POLL_INTERVAL_MS = 15_000;

interface ScheduledTaskExecutionResult {
  success: boolean;
  message?: string | null;
}

interface ScheduledTaskExecutionOptions {
  runId: string;
}

interface LocalSchedulerConfig {
  executeTask: (task: ScheduledTask, options: ScheduledTaskExecutionOptions) => Promise<ScheduledTaskExecutionResult>;
  onTasksChanged?: () => void;
}

class LocalScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly inFlightTaskIds = new Set<string>();

  constructor(private readonly config: LocalSchedulerConfig) {}

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

  async runTaskNow(taskId: string): Promise<{ success: boolean; error?: string }> {
    const task = scheduledTaskStore.getTaskById(taskId);
    if (!task) {
      return { success: false, error: "Scheduled task not found." };
    }
    if (this.inFlightTaskIds.has(task.id)) {
      return { success: false, error: "Scheduled task is already queued or running." };
    }

    void this.executeTask(task, "manual");
    return { success: true };
  }

  markTaskRunning(runId: string): void {
    const task = scheduledTaskStore.listTasks().find((entry) => entry.activeRunId === runId);
    if (!task || task.lastRunStatus === "running") {
      return;
    }
    scheduledTaskStore.saveTask({
      ...task,
      lastRunStatus: "running",
      lastError: null,
    });
    scheduledTaskStore.appendEvent(task.id, {
      runId,
      level: "info",
      message: "Task execution started.",
      meta: {
        state: "running",
      },
    });
    appLogger.info("scheduler", "Scheduled task started running.", {
      taskId: task.id,
      projectId: task.projectId,
      runId,
    });
    this.config.onTasksChanged?.();
  }

  private async tick(reason: string): Promise<void> {
    this.reconcileTasks(reason);
    const now = Date.now();
    const dueTasks = scheduledTaskStore.listTasks()
      .filter((task) => !this.inFlightTaskIds.has(task.id))
      .filter((task) => isScheduledTaskDue(task, now));

    for (const task of dueTasks) {
      void this.executeTask(task, "scheduled");
    }
  }

  private reconcileTasks(reason: string): void {
    const now = Date.now();
    let changed = false;
    for (const task of scheduledTaskStore.listTasks()) {
      let nextStatus = task.lastRunStatus;
      let nextError = task.lastError ?? null;
      let nextActiveRunId = task.activeRunId ?? null;
      let nextRetryCount = task.retryCount ?? 0;
      if ((task.lastRunStatus === "queued" || task.lastRunStatus === "running") && !this.inFlightTaskIds.has(task.id)) {
        nextStatus = "error";
        nextError = nextError || "Desktop restarted before the scheduled task finished.";
        nextActiveRunId = null;
      }

      const baseNextRunAt = computeScheduledTaskNextRunAt({
        scheduleType: task.scheduleType,
        enabled: task.enabled,
        runAt: task.runAt,
        delayMinutes: task.delayMinutes,
        delayStartAt: task.delayStartAt,
        dailyTime: task.dailyTime,
        weeklyDay: task.weeklyDay,
        lastRunAt: task.lastRunAt,
      }, now);
      const preserveRetryRunAt = nextStatus === "error"
        && (task.retryCount ?? 0) > 0
        && task.nextRunAt !== null
        && task.nextRunAt !== undefined;
      const nextRunAt = preserveRetryRunAt ? task.nextRunAt ?? null : baseNextRunAt;

      if (nextStatus !== "error" && nextRetryCount !== 0) {
        nextRetryCount = 0;
      }

      if (
        nextStatus === task.lastRunStatus
        && nextError === (task.lastError ?? null)
        && nextRetryCount === (task.retryCount ?? 0)
        && nextRunAt === (task.nextRunAt ?? null)
        && nextActiveRunId === (task.activeRunId ?? null)
      ) {
        continue;
      }

      scheduledTaskStore.saveTask({
        ...task,
        lastRunStatus: nextStatus,
        lastError: nextError,
        retryCount: nextRetryCount,
        activeRunId: nextActiveRunId,
        nextRunAt,
      });
      if (nextStatus === "error" && task.lastRunStatus !== "error") {
        scheduledTaskStore.appendEvent(task.id, {
          runId: task.activeRunId ?? null,
          level: "error",
          message: nextError || "Scheduled task stopped unexpectedly.",
          meta: {
            reason,
            state: "recovered-error",
          },
        });
        appLogger.warn("scheduler", "Recovered scheduled task with stale in-flight state.", {
          taskId: task.id,
          projectId: task.projectId,
          runId: task.activeRunId ?? null,
          previousStatus: task.lastRunStatus,
          reason,
          recoveryState: "restart-residue",
          nextRunAt,
        });
      }
      changed = true;
    }

    if (changed) {
      appLogger.info("scheduler", "Reconciled scheduled tasks.", { reason });
      this.config.onTasksChanged?.();
    }
  }

  private async executeTask(task: ScheduledTask, trigger: "scheduled" | "manual"): Promise<void> {
    const latestTask = scheduledTaskStore.getTaskById(task.id);
    if (!latestTask || this.inFlightTaskIds.has(task.id)) {
      return;
    }

    const runId = uuidv4();
    this.inFlightTaskIds.add(task.id);
    scheduledTaskStore.saveTask({
      ...latestTask,
      lastRunStatus: "queued",
      lastError: null,
      activeRunId: runId,
      nextRunAt: null,
    });
    scheduledTaskStore.appendEvent(latestTask.id, {
      runId,
      level: "info",
      message: trigger === "manual" ? "Task queued manually." : "Task queued by scheduler.",
      meta: {
        trigger,
        scheduleType: latestTask.scheduleType,
        retryCount: latestTask.retryCount ?? 0,
      },
    });
    this.config.onTasksChanged?.();
    appLogger.info("scheduler", "Queued scheduled task.", {
      taskId: latestTask.id,
      projectId: latestTask.projectId,
      trigger,
      runId,
      scheduleType: latestTask.scheduleType,
    });

    try {
      const result = await this.config.executeTask(latestTask, { runId });
      const completedAt = Date.now();
      const persisted = scheduledTaskStore.getTaskById(task.id) ?? latestTask;
      const nextRunAt = computeScheduledTaskNextRunAt({
        scheduleType: persisted.scheduleType,
        enabled: persisted.enabled,
        runAt: persisted.runAt,
        delayMinutes: persisted.delayMinutes,
        delayStartAt: persisted.delayStartAt,
        dailyTime: persisted.dailyTime,
        weeklyDay: persisted.weeklyDay,
        lastRunAt: completedAt,
      }, completedAt);
      const shouldDisable = (persisted.scheduleType === "once" || persisted.scheduleType === "delay") && nextRunAt === null;

      scheduledTaskStore.saveTask({
        ...persisted,
        enabled: shouldDisable ? false : persisted.enabled,
        activeRunId: null,
        lastRunAt: completedAt,
        lastRunStatus: result.success ? "success" : "error",
        lastError: result.success ? null : (result.message?.trim() || "Scheduled task failed."),
        retryCount: 0,
        nextRunAt,
      });
      scheduledTaskStore.appendEvent(persisted.id, {
        runId,
        level: "info",
        message: "Task completed successfully.",
        meta: {
          trigger,
          nextRunAt,
          disabled: shouldDisable,
          scheduleType: persisted.scheduleType,
        },
      });
      appLogger.info("scheduler", "Scheduled task finished.", {
        taskId: persisted.id,
        projectId: persisted.projectId,
        trigger,
        success: result.success,
        nextRunAt,
        disabled: shouldDisable,
      });
    } catch (error) {
      const completedAt = Date.now();
      const persisted = scheduledTaskStore.getTaskById(task.id) ?? latestTask;
      const baseNextRunAt = computeScheduledTaskNextRunAt({
        scheduleType: persisted.scheduleType,
        enabled: persisted.enabled,
        runAt: persisted.runAt,
        delayMinutes: persisted.delayMinutes,
        delayStartAt: persisted.delayStartAt,
        dailyTime: persisted.dailyTime,
        weeklyDay: persisted.weeklyDay,
        lastRunAt: completedAt,
      }, completedAt);
      const nextRetryCount = (persisted.retryCount ?? 0) + 1;
      const maxRetries = Math.max(0, persisted.maxRetries ?? 0);
      const retryDelayMinutes = Math.max(1, persisted.retryDelayMinutes ?? 5);
      const shouldRetry = nextRetryCount <= maxRetries;
      const retryRunAt = shouldRetry ? completedAt + retryDelayMinutes * 60 * 1000 : null;
      const nextRunAt = retryRunAt ?? baseNextRunAt;
      const shouldDisable = (persisted.scheduleType === "once" || persisted.scheduleType === "delay")
        && nextRunAt === null;
      const message = error instanceof Error ? error.message : String(error);

      scheduledTaskStore.saveTask({
        ...persisted,
        enabled: shouldDisable ? false : persisted.enabled,
        activeRunId: null,
        lastRunAt: completedAt,
        lastRunStatus: "error",
        lastError: shouldRetry ? `${message} Retrying automatically.` : message,
        retryCount: shouldRetry ? nextRetryCount : 0,
        nextRunAt,
      });
      scheduledTaskStore.appendEvent(persisted.id, {
        runId,
        level: "error",
        message: shouldRetry ? `${message} Retrying automatically.` : message,
        meta: {
          trigger,
          retryCount: shouldRetry ? nextRetryCount : 0,
          maxRetries,
          retryRunAt,
          nextRunAt,
          scheduleType: persisted.scheduleType,
        },
      });
      appLogger.warn("scheduler", "Scheduled task failed.", {
        taskId: persisted.id,
        projectId: persisted.projectId,
        trigger,
        error: message,
        retryCount: shouldRetry ? nextRetryCount : 0,
        maxRetries,
        retryRunAt,
      });
    } finally {
      this.inFlightTaskIds.delete(task.id);
      this.config.onTasksChanged?.();
    }
  }
}

export default LocalScheduler;
