import { TimedAsyncCacheLoadOptions } from "./timed-async-cache";

interface KeyedTimedAsyncCacheEntry<T> {
  value: T | null;
  fetchedAt: number;
  inFlight: Promise<T> | null;
  generation: number;
}

export interface KeyedTimedAsyncCache<T> {
  get(key: string, options?: TimedAsyncCacheLoadOptions): Promise<T>;
  clear(key?: string): void;
  peek(key: string): T | null;
}

interface KeyedTimedAsyncCacheOptions<T> {
  ttlMs: number;
  load: (key: string) => Promise<T>;
  now?: () => number;
}

function createEmptyEntry<T>(): KeyedTimedAsyncCacheEntry<T> {
  return {
    value: null,
    fetchedAt: 0,
    inFlight: null,
    generation: 0,
  };
}

export function createKeyedTimedAsyncCache<T>(options: KeyedTimedAsyncCacheOptions<T>): KeyedTimedAsyncCache<T> {
  const ttlMs = Math.max(0, Math.floor(options.ttlMs || 0));
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, KeyedTimedAsyncCacheEntry<T>>();

  function getEntry(key: string): KeyedTimedAsyncCacheEntry<T> {
    const normalizedKey = String(key ?? "");
    let entry = entries.get(normalizedKey);
    if (!entry) {
      entry = createEmptyEntry<T>();
      entries.set(normalizedKey, entry);
    }
    return entry;
  }

  async function get(key: string, loadOptions: TimedAsyncCacheLoadOptions = {}): Promise<T> {
    const entry = getEntry(key);
    if (entry.inFlight) {
      return await entry.inFlight;
    }

    const shouldReuseCachedValue = !loadOptions.force
      && entry.value !== null
      && now() - entry.fetchedAt < ttlMs;
    if (shouldReuseCachedValue) {
      return entry.value as T;
    }

    const pendingLoad = options.load(String(key ?? ""));
    const loadGeneration = entry.generation;
    entry.inFlight = pendingLoad;
    try {
      const nextValue = await pendingLoad;
      if (entry.generation === loadGeneration) {
        entry.value = nextValue;
        entry.fetchedAt = now();
      }
      return nextValue;
    } finally {
      if (entry.inFlight === pendingLoad) {
        entry.inFlight = null;
      }
    }
  }

  function clear(key?: string): void {
    if (typeof key === "string") {
      const entry = getEntry(key);
      entry.generation += 1;
      entry.value = null;
      entry.fetchedAt = 0;
      entry.inFlight = null;
      return;
    }
    for (const entry of entries.values()) {
      entry.generation += 1;
      entry.value = null;
      entry.fetchedAt = 0;
      entry.inFlight = null;
    }
  }

  function peek(key: string): T | null {
    return getEntry(key).value;
  }

  return {
    get,
    clear,
    peek,
  };
}
