import { useCallback, useEffect, useState } from 'react';

/**
 * Data-fetching hook with explicit loading/error states.
 * `deps` controls refetching; `enabled` defers the call until prerequisites exist.
 */
export function useApi(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, meta: {}, loading: enabled, error: null });

  const load = useCallback(async () => {
    if (!enabled) return setState((s) => ({ ...s, loading: false }));
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data, meta } = await fn();
      setState({ data, meta, loading: false, error: null });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => { load(); }, [load]);

  return { ...state, reload: load };
}

/** Persisted UI preference (league id, pick mode, my roster). */
export function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : JSON.parse(raw);
    } catch { return initial; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }, [key, value]);
  return [value, setValue];
}
