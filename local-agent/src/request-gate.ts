export interface RequestGateStartOptions {
  force?: boolean;
}

export interface RequestGate {
  tryStart(key: string, options?: RequestGateStartOptions): boolean;
  finish(key: string): void;
  clear(): void;
}

interface RequestGateEntry {
  lastStartedAt: number;
  timeout: NodeJS.Timeout | null;
  pending: boolean;
}

interface RequestGateOptions {
  minIntervalMs: number;
  pendingTimeoutMs: number;
  now?: () => number;
}

export function createRequestGate(options: RequestGateOptions): RequestGate {
  const minIntervalMs = Math.max(0, Math.floor(options.minIntervalMs || 0));
  const pendingTimeoutMs = Math.max(0, Math.floor(options.pendingTimeoutMs || 0));
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, RequestGateEntry>();

  function getEntry(key: string): RequestGateEntry | null {
    return entries.get(String(key ?? "").trim()) ?? null;
  }

  function finish(key: string): void {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) {
      return;
    }
    const entry = entries.get(normalizedKey);
    if (!entry) {
      return;
    }
    if (entry.timeout) {
      clearTimeout(entry.timeout);
      entry.timeout = null;
    }
    entry.pending = false;
  }

  function tryStart(key: string, startOptions: RequestGateStartOptions = {}): boolean {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) {
      return false;
    }

    const existingEntry = getEntry(normalizedKey);
    if (existingEntry?.pending) {
      return false;
    }

    const lastStartedAt = existingEntry?.lastStartedAt ?? 0;
    if (existingEntry && !startOptions.force && now() - lastStartedAt < minIntervalMs) {
      return false;
    }

    const entry: RequestGateEntry = {
      lastStartedAt: now(),
      timeout: null,
      pending: true,
    };
    if (pendingTimeoutMs > 0) {
      entry.timeout = setTimeout(() => {
        finish(normalizedKey);
      }, pendingTimeoutMs);
    }
    entries.set(normalizedKey, entry);
    return true;
  }

  function clear(): void {
    for (const [key, entry] of entries.entries()) {
      if (entry.timeout) {
        clearTimeout(entry.timeout);
      }
      entries.delete(key);
    }
  }

  return {
    tryStart,
    finish,
    clear,
  };
}
