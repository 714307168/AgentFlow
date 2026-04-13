export interface TimedAsyncCacheLoadOptions {
  force?: boolean;
}

export interface TimedAsyncCache<T> {
  get(options?: TimedAsyncCacheLoadOptions): Promise<T>;
  clear(): void;
  peek(): T | null;
}

interface TimedAsyncCacheOptions<T> {
  ttlMs: number;
  load: () => Promise<T>;
  now?: () => number;
}

export function createTimedAsyncCache<T>(options: TimedAsyncCacheOptions<T>): TimedAsyncCache<T> {
  const ttlMs = Math.max(0, Math.floor(options.ttlMs || 0));
  const now = options.now ?? (() => Date.now());
  let value: T | null = null;
  let fetchedAt = 0;
  let inFlight: Promise<T> | null = null;
  let generation = 0;

  async function get(loadOptions: TimedAsyncCacheLoadOptions = {}): Promise<T> {
    if (inFlight) {
      return await inFlight;
    }

    const shouldReuseCachedValue = !loadOptions.force
      && value !== null
      && now() - fetchedAt < ttlMs;
    if (shouldReuseCachedValue) {
      const cachedValue = value;
      if (cachedValue !== null) {
        return cachedValue;
      }
    }

    const pendingLoad = options.load();
    const loadGeneration = generation;
    inFlight = pendingLoad;
    try {
      const nextValue = await pendingLoad;
      if (generation === loadGeneration) {
        value = nextValue;
        fetchedAt = now();
      }
      return nextValue;
    } finally {
      if (inFlight === pendingLoad) {
        inFlight = null;
      }
    }
  }

  function clear(): void {
    generation += 1;
    value = null;
    fetchedAt = 0;
    inFlight = null;
  }

  function peek(): T | null {
    return value;
  }

  return {
    get,
    clear,
    peek,
  };
}
