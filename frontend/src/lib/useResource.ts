import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useResource<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const runId = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // loader is intentionally not a dependency — every call site passes a fresh
  // inline arrow, so the fetch re-runs on `deps` changes only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    loader()
      .then((v) => {
        if (mounted.current && id === runId.current) {
          setData(v);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted.current && id === runId.current) {
          setError(err instanceof Error ? err.message : 'Erro ao carregar');
          setLoading(false);
        }
      });
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, error, loading, reload: run };
}
