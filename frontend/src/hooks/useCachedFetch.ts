import { useEffect, useRef, useState } from "react";

type Entry<T> = { data: T; fetchedAt: number };

const cache = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const subs = new Map<string, Set<() => void>>();

function notify(key: string) {
  subs.get(key)?.forEach((cb) => cb());
}

function subscribe(key: string, cb: () => void): () => void {
  let set = subs.get(key);
  if (!set) {
    set = new Set();
    subs.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subs.delete(key);
  };
}

async function refresh<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = (async () => {
    try {
      const data = await fetcher();
      cache.set(key, { data, fetchedAt: Date.now() });
      notify(key);
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

export type CacheState<T> = {
  data: T | null;
  isStale: boolean;
  isFetching: boolean;
  error: string | null;
  refetch: () => void;
};

/** Stale-while-revalidate fetch. Module-level cache means tab switches don't
 * re-flash the loading state; data updates in the background and components
 * subscribed to the same key all re-render together. */
export function useCachedFetch<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { refreshMs?: number; staleAfterMs?: number } = {},
): CacheState<T> {
  const { refreshMs, staleAfterMs = 30_000 } = opts;
  const [, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key) return;
    const onChange = () => setTick((n) => n + 1);
    const unsub = subscribe(key, onChange);

    const cached = cache.get(key);
    const stale = !cached || Date.now() - cached.fetchedAt > staleAfterMs;
    if (stale) {
      setIsFetching(true);
      refresh(key, fetcherRef.current)
        .then(() => setError(null))
        .catch((e) => setError((e as Error).message))
        .finally(() => setIsFetching(false));
    }

    let intervalId: number | undefined;
    if (refreshMs) {
      intervalId = window.setInterval(() => {
        setIsFetching(true);
        refresh(key, fetcherRef.current)
          .then(() => setError(null))
          .catch((e) => setError((e as Error).message))
          .finally(() => setIsFetching(false));
      }, refreshMs);
    }

    return () => {
      unsub();
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [key, refreshMs, staleAfterMs]);

  const cached = key ? (cache.get(key) as Entry<T> | undefined) : undefined;
  const refetch = () => {
    if (!key) return;
    cache.delete(key);
    setIsFetching(true);
    refresh(key, fetcherRef.current)
      .then(() => setError(null))
      .catch((e) => setError((e as Error).message))
      .finally(() => setIsFetching(false));
  };

  return {
    data: cached?.data ?? null,
    isStale: cached ? Date.now() - cached.fetchedAt > staleAfterMs : false,
    isFetching,
    error,
    refetch,
  };
}

export function clearCacheKey(key: string) {
  cache.delete(key);
  notify(key);
}
