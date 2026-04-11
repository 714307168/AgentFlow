export interface CoalescedTriggerOptions {
  minIntervalMs: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface CoalescedTrigger {
  trigger(task: () => void): { immediate: boolean; scheduled: boolean };
  dispose(): void;
}

export function createCoalescedTrigger(options: CoalescedTriggerOptions): CoalescedTrigger {
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as NodeJS.Timeout));
  const minIntervalMs = Math.max(0, Math.trunc(options.minIntervalMs));

  let lastTriggeredAt = 0;
  let timerHandle: unknown = null;
  let pendingTask: (() => void) | null = null;

  const runPendingTask = (): void => {
    timerHandle = null;
    const task = pendingTask;
    pendingTask = null;
    if (!task) {
      return;
    }
    lastTriggeredAt = now();
    task();
  };

  return {
    trigger(task: () => void) {
      const currentTime = now();
      const elapsedMs = currentTime - lastTriggeredAt;
      if (!timerHandle && elapsedMs >= minIntervalMs) {
        lastTriggeredAt = currentTime;
        pendingTask = null;
        task();
        return { immediate: true, scheduled: false };
      }

      pendingTask = task;
      if (!timerHandle) {
        const delayMs = Math.max(0, minIntervalMs - Math.max(0, elapsedMs));
        timerHandle = setTimer(runPendingTask, delayMs);
      }
      return { immediate: false, scheduled: true };
    },
    dispose() {
      if (timerHandle) {
        clearTimer(timerHandle);
        timerHandle = null;
      }
      pendingTask = null;
    },
  };
}
