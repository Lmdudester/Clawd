import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { UsageResponse } from '@clawd/shared';

let cachedUsage: UsageResponse | null = null;
let cachedError: string | null = null;
let fetchPromise: Promise<UsageResponse> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function useUsage() {
  const [, rerender] = useState(0);
  const [loading, setLoading] = useState(!cachedUsage && !cachedError);

  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const refresh = useCallback(() => {
    if (fetchPromise) return;
    setLoading(true);
    cachedError = null;
    fetchPromise = api.getUsage();
    fetchPromise
      .then((data) => { cachedUsage = data; })
      .catch((err) => { cachedError = err instanceof Error ? err.message : String(err || 'Failed to load API usage data'); })
      .finally(() => { fetchPromise = null; setLoading(false); notify(); });
  }, []);

  useEffect(() => {
    if (!cachedUsage && !cachedError) {
      refresh();
    }
  }, [refresh]);

  return { usage: cachedUsage, loading, error: cachedError, refresh };
}
