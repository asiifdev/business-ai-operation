import { useCallback, useEffect, useRef, useState } from 'react';

export type Loaded<T> = { state: 'loading' } | { state: 'error'; error: unknown } | { state: 'ready'; data: T };

/**
 * Loads data when the page opens and again on `reload()`. The four states every screen needs (loading, error, ready, and
 * empty which the caller derives from `data`) start here. A stale answer never overwrites a newer one.
 */
export function useLoad<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []) {
  const [value, setValue] = useState<Loaded<T>>({ state: 'loading' });
  const latest = useRef(0);
  const run = useCallback(
    async (quiet: boolean) => {
      const ticket = ++latest.current;
      if (!quiet) setValue({ state: 'loading' });
      try {
        const data = await fetcher();
        if (ticket === latest.current) setValue({ state: 'ready', data });
      } catch (error) {
        if (ticket === latest.current) setValue({ state: 'error', error });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  useEffect(() => {
    void run(false);
  }, [run]);
  return { value, reload: () => run(true), retry: () => run(false) };
}
