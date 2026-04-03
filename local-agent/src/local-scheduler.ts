import appLogger from "./app-logger";
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

interface LocalSchedulerConfig {
  executeTask: (task: ScheduledTask) => Promise<ScheduledTaskExecutionResult>;
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
      if (task.lastRunStatus === "queued" && !this.inFlightTaskIds.has(task.id)) {
        nextStatus = "error";
        nextError = nextError || "Desktop restarted before the scheduled task finished.";
      }

      const nextRunAt = computeScheduledTaskNextRunAt({
        scheduleType: task.scheduleType,
        enabled: task.enabled,
        runAt: task.runAt,
        dailyTime: task.dailyTime,
        lastRunAt: task.lastRunAt,
      }, now);

      if (nextStatus === task.lastRunStatus && nextError === (task.lastError ?? null) && nextRunAt === (task.nextRunAt ?? null)) {
        continue;
      }

      scheduledTaskStore.saveTask({
        ...task,
        lastRunStatus: nextStatus,
        lastError: nextError,
        nextRunAt,
      });
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

    this.inFlightTaskIds.add(task.id);
    scheduledTaskStore.saveTask({
      ...latestTask,
      lastRunStatus: "queued",
      lastError: null,
      nextRunAt: null,
    });
    this.config.onTasksChanged?.();
    appLogger.info("scheduler", "Queued scheduled task.", {
      taskId: latestTask.id,
      projectId: latestTask.projectId,
      trigger,
      scheduleType: latestTask.scheduleType,
    });

    try {
      const result = await this.config.executeTask(latestTask);
      const completedAt = Date.now();
      const persisted = scheduledTaskStore.getTaskById(task.id) ?? latestTask;
      const nextRunAt = computeScheduledTaskNextRunAt({
        scheduleType: persisted.scheduleType,
        enabled: persisted.enabled,
        runAt: persisted.runAt,
        dailyTime: persisted.dailyTime,
        lastRunAt: completedAt,
      }, completedAt);
      const shouldDisable = persisted.scheduleType === "once" && nextRunAt === null;

      scheduledTaskStore.saveTask({
        ...persisted,
        enabled: shouldDisable ? false : persisted.enabled,
        lastRunAt: completedAt,
        lastRunStatus: result.success ? "success" : "error",
        lastError: result.success ? null : (result.message?.trim() || "Scheduled task failed."),
        nextRunAt,
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
      const nextRunAt = computeScheduledTaskNextRunAt({
        scheduleType: persisted.scheduleType,
        enabled: persisted.enabled,
        runAt: persisted.runAt,
        dailyTime: persisted.dailyTime,
        lastRunAt: completedAt,
      }, completedAt);
      const shouldDisable = persisted.scheduleType === "once" && nextRunAt === null;
      const message = error instanceof Error ? error.message : String(error);

      scheduledTaskStore.saveTask({
        ...persisted,
        enabled: shouldDisable ? false : persisted.enabled,
        lastRunAt: completedAt,
        lastRunStatus: "error",
        lastError: message,
        nextRunAt,
      });
      appLogger.warn("scheduler", "Scheduled task failed.", {
        taskId: persisted.id,
        projectId: persisted.projectId,
        trigger,
        error: message,
      });
    } finally {
      this.inFlightTaskIds.delete(task.id);
      this.config.onTasksChanged?.();
    }
  }
}

export default LocalScheduler;
