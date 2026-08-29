import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as api from '../lib/api.js';

const STORAGE_KEY = 'fumarende.month';
const MONTH_RE = /^\d{4}-\d{2}$/;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function readStored(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && MONTH_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

interface MonthContextValue {
  month: string;
  setMonth: (m: string) => void;
  months: string[];
}

const MonthContext = createContext<MonthContextValue | undefined>(undefined);

export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonthState] = useState<string>(() => readStored() ?? currentMonth());
  const [dataMonths, setDataMonths] = useState<string[]>([]);

  const setMonth = useCallback((m: string) => {
    setMonthState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* storage unavailable — the in-memory value still updates */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .listMonthlyClose()
      .then((rows) => {
        if (!cancelled) setDataMonths(rows.map((r) => r.month));
      })
      .catch(() => {
        if (!cancelled) setDataMonths([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const months = useMemo(() => {
    const set = new Set<string>([currentMonth(), month, ...dataMonths]);
    return [...set].filter((m) => MONTH_RE.test(m)).sort().reverse();
  }, [month, dataMonths]);

  const value = useMemo(() => ({ month, setMonth, months }), [month, setMonth, months]);

  return <MonthContext.Provider value={value}>{children}</MonthContext.Provider>;
}

export function useMonth(): MonthContextValue {
  const ctx = useContext(MonthContext);
  if (!ctx) throw new Error('useMonth must be used within a MonthProvider');
  return ctx;
}
