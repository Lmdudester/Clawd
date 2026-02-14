import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { UsageResponse } from '@clawd/shared';

let cachedUsage: UsageResponse | null = null;
let fetchPromise: Promise<UsageResponse> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function useUsage() {
  const [, rerender] = useState(0);
  const [loading, setLoading] = useState(!cachedUsage);
  const [error, setError] = useState(false);

  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(false);
    fetchPromise = api.getUsage();
    fetchPromise
      .then((data) => { cachedUsage = data; notify(); })
      .catch(() => setError(true))
      .finally(() => { fetchPromise = null; setLoading(false); });
  }, []);

  useEffect(() => {
    if (!cachedUsage && !fetchPromise) refresh();
  }, [refresh]);

  return { usage: cachedUsage, loading, error, refresh };
}
