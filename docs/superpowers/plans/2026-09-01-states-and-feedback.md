# States & Feedback Implementation Plan (Phase 2.5.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every page a loading skeleton, an error state with retry,
a standard empty state, inline per-field form validation, success/error
toasts, and a real progress UI for the PDF import.

**Architecture:** A `useResource(loader, deps?)` hook replaces the
`useState / useEffect / refresh` trio on all 11 pages; an
`<AsyncBoundary>` renders `<Skeleton>` / an error card / children; a
`ToastContext` provides `useToast()`; a `<Field>` + `useFormErrors()`
pair standardises labelled controls and validation. Three-way feedback
split: field errors inline, action failures as toasts, load failures as
the boundary's error card. Frontend only — the sole `api.ts` change is
an optional `AbortSignal` on `importPreviewStatement`.

**Tech Stack:** React 18, React Router 6, Vite 6, Vitest
(+ `@testing-library/react`), plain CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-01-states-and-feedback-design.md`

## Global Constraints

- **Frontend only.** No server change, no new endpoint, no
  `scripts/qa-e2e.sh` change. `importPreviewStatement` gains an optional
  3rd param `signal?: AbortSignal` — the only `api.ts` signature change.
- **No content or layout redesign.** This slice adds *states*; the
  `<h1 className="page-title">` stays outside `<AsyncBoundary>` so the
  title is always visible; everything else the page rendered still
  renders, just wrapped.
- **The three-way feedback split is mandatory and consistent:** invalid
  field value → `<Field error>` inline (no toast); server rejects a
  mutation → `toast('error', message)`; initial/`reload` fetch throws →
  `<AsyncBoundary>` error card with **Recarregar**. The old single
  `error` string per page is removed.
- **No optimistic updates** — after a mutation the page still
  `reload()`s.
- **No form library.** `useFormErrors` is ~20 lines.
- `useResource`'s effect depends on `deps` only, never on `loader`
  (callers pass a fresh inline arrow each render). Guard against
  `setState` after unmount and against a stale run resolving after a
  newer one.
- Every animation (`skeleton-pulse`, toast slide, progress bar) is
  disabled under `@media (prefers-reduced-motion: reduce)`.
- TDD for the new hooks/components (tests lead). The page migrations are
  green-keeping refactors — their existing tests, adjusted per this
  plan, must pass. Frontend tests run from `frontend/`. Branch
  `states-feedback` off `main`; the finishing skill merges it. One
  commit per task.

---

## Shared Types

```ts
// lib/useResource.ts
export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}
export function useResource<T>(loader: () => Promise<T>, deps?: unknown[]): Resource<T>;

// lib/useFormErrors.ts
export interface FormErrors {
  errors: Record<string, string>;
  setError: (field: string, message: string) => void;
  clearError: (field: string) => void;
  clearAll: () => void;
  hasErrors: boolean;
}
export function useFormErrors(): FormErrors;

// context/ToastContext.tsx
type ToastKind = 'success' | 'error';
export function useToast(): { toast: (kind: ToastKind, message: string) => void };
```

---

## Task 1: `useResource` + `useFormErrors` hooks

**Files:**
- Create: `frontend/src/lib/useResource.ts` + `frontend/src/lib/useResource.test.tsx`
- Create: `frontend/src/lib/useFormErrors.ts` + `frontend/src/lib/useFormErrors.test.tsx`

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/useResource.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useResource } from './useResource.js';

function Probe({ loader, dep }: { loader: () => Promise<string>; dep?: number }) {
  const r = useResource(loader, [dep]);
  return (
    <div>
      <span data-testid="loading">{String(r.loading)}</span>
      <span data-testid="data">{r.data ?? ''}</span>
      <span data-testid="error">{r.error ?? ''}</span>
      <button onClick={r.reload}>reload</button>
    </div>
  );
}

describe('useResource', () => {
  it('goes loading → resolved', async () => {
    const loader = vi.fn().mockResolvedValue('hello');
    render(<Probe loader={loader} />);
    expect(screen.getByTestId('loading').textContent).toBe('true');
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('hello'));
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('surfaces a rejection as an error message', async () => {
    render(<Probe loader={() => Promise.reject(new Error('boom'))} />);
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('boom'));
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('reload() re-runs the loader', async () => {
    const loader = vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');
    render(<Probe loader={loader} />);
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('a'));
    fireEvent.click(screen.getByText('reload'));
    await waitFor(() => expect(screen.getByTestId('data').textContent).toBe('b'));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not set state after unmount', async () => {
    let resolve: (v: string) => void = () => {};
    const loader = () => new Promise<string>((r) => (resolve = r));
    const { unmount } = render(<Probe loader={loader} />);
    unmount();
    resolve('late');
    await new Promise((r) => setTimeout(r, 0)); // no act() warning, no throw
  });
});
```

`frontend/src/lib/useFormErrors.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFormErrors } from './useFormErrors.js';

function Probe() {
  const f = useFormErrors();
  return (
    <div>
      <span data-testid="amount">{f.errors.amount ?? ''}</span>
      <span data-testid="has">{String(f.hasErrors)}</span>
      <button onClick={() => f.setError('amount', 'bad')}>set</button>
      <button onClick={() => f.clearError('amount')}>clear</button>
      <button onClick={() => f.clearAll()}>clearAll</button>
    </div>
  );
}

describe('useFormErrors', () => {
  it('set / clear / clearAll and hasErrors', () => {
    render(<Probe />);
    expect(screen.getByTestId('has').textContent).toBe('false');
    fireEvent.click(screen.getByText('set'));
    expect(screen.getByTestId('amount').textContent).toBe('bad');
    expect(screen.getByTestId('has').textContent).toBe('true');
    fireEvent.click(screen.getByText('clear'));
    expect(screen.getByTestId('has').textContent).toBe('false');
    fireEvent.click(screen.getByText('set'));
    fireEvent.click(screen.getByText('clearAll'));
    expect(screen.getByTestId('has').textContent).toBe('false');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/lib/useResource.test.tsx src/lib/useFormErrors.test.tsx`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `useResource.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useResource<T>(loader: () => Promise<T>, deps: unknown[] = []): Resource<T> {
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
    // loader is intentionally not a dep — callers pass a fresh arrow each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { data, error, loading, reload: run };
}
```

- [ ] **Step 4: Implement `useFormErrors.ts`**

```ts
import { useCallback, useMemo, useState } from 'react';

export interface FormErrors {
  errors: Record<string, string>;
  setError: (field: string, message: string) => void;
  clearError: (field: string) => void;
  clearAll: () => void;
  hasErrors: boolean;
}

export function useFormErrors(): FormErrors {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setError = useCallback((field: string, message: string) => {
    setErrors((e) => ({ ...e, [field]: message }));
  }, []);
  const clearError = useCallback((field: string) => {
    setErrors((e) => {
      if (!(field in e)) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });
  }, []);
  const clearAll = useCallback(() => setErrors({}), []);

  const hasErrors = useMemo(() => Object.keys(errors).length > 0, [errors]);
  return { errors, setError, clearError, clearAll, hasErrors };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd frontend && npx vitest run src/lib/useResource.test.tsx src/lib/useFormErrors.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/useResource.ts frontend/src/lib/useResource.test.tsx frontend/src/lib/useFormErrors.ts frontend/src/lib/useFormErrors.test.tsx
git commit -m "Add useResource + useFormErrors hooks

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `Skeleton` + `AsyncBoundary` + `EmptyState`

**Files:**
- Create: `frontend/src/components/Skeleton.tsx` + `.test.tsx`
- Create: `frontend/src/components/AsyncBoundary.tsx` + `.test.tsx`
- Create: `frontend/src/components/EmptyState.tsx` + `.test.tsx`
- Modify: `frontend/src/theme.css`

- [ ] **Step 1: Write the failing tests**

`Skeleton.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from './Skeleton.js';

describe('Skeleton', () => {
  it('renders the requested number of blocks and is hidden from a11y', () => {
    const { container } = render(<Skeleton rows={4} />);
    const root = container.querySelector('.skeleton')!;
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root.querySelectorAll('.skeleton__block')).toHaveLength(4);
  });
});
```

`AsyncBoundary.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AsyncBoundary } from './AsyncBoundary.js';

describe('AsyncBoundary', () => {
  it('shows a skeleton while loading, not the children', () => {
    const { container } = render(
      <AsyncBoundary loading error={null} onRetry={() => {}}>
        <p>conteúdo</p>
      </AsyncBoundary>,
    );
    expect(container.querySelector('.skeleton')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
  });

  it('shows the error message + a working Recarregar', () => {
    const onRetry = vi.fn();
    render(
      <AsyncBoundary loading={false} error="rede caiu" onRetry={onRetry}>
        <p>conteúdo</p>
      </AsyncBoundary>,
    );
    expect(screen.getByText('rede caiu')).toBeInTheDocument();
    expect(screen.queryByText('conteúdo')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders children when resolved', () => {
    render(
      <AsyncBoundary loading={false} error={null} onRetry={() => {}}>
        <p>conteúdo</p>
      </AsyncBoundary>,
    );
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });
});
```

`EmptyState.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('shows the message, and the action only when given', () => {
    const { rerender } = render(<EmptyState message="Nada aqui." />);
    expect(screen.getByText('Nada aqui.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<EmptyState message="Nada aqui." action={<button>Criar</button>} />);
    expect(screen.getByRole('button', { name: 'Criar' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/Skeleton.test.tsx src/components/AsyncBoundary.test.tsx src/components/EmptyState.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the components**

`Skeleton.tsx`:

```tsx
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      <div className="skeleton__bar" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton__block" />
      ))}
    </div>
  );
}
```

`AsyncBoundary.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Skeleton } from './Skeleton.js';

export function AsyncBoundary({
  loading,
  error,
  onRetry,
  skeletonRows,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  skeletonRows?: number;
  children: ReactNode;
}) {
  if (error) {
    return (
      <div className="card async-error">
        <p className="muted">{error}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
          Recarregar
        </button>
      </div>
    );
  }
  if (loading) return <Skeleton rows={skeletonRows} />;
  return <>{children}</>;
}
```

`EmptyState.tsx`:

```tsx
import type { ReactNode } from 'react';

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="subtle">{message}</p>
      {action}
    </div>
  );
}
```

- [ ] **Step 4: Add the CSS**

Append to `frontend/src/theme.css`:

```css
/* ---- async / empty ---- */
.skeleton { display: flex; flex-direction: column; gap: var(--space-3); }
.skeleton__bar,
.skeleton__block {
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
.skeleton__bar { height: 1.6rem; width: 40%; }
.skeleton__block { height: 88px; }
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
.async-error { display: flex; flex-direction: column; gap: var(--space-3); align-items: flex-start; }
.empty-state {
  display: flex; flex-direction: column; gap: var(--space-3);
  align-items: flex-start; padding: var(--space-4) 0;
}
@media (prefers-reduced-motion: reduce) {
  .skeleton__bar, .skeleton__block { animation: none; opacity: 0.7; }
}
```

- [ ] **Step 5: Run to verify they pass + build**

Run: `cd frontend && npx vitest run src/components/Skeleton.test.tsx src/components/AsyncBoundary.test.tsx src/components/EmptyState.test.tsx`
Expected: PASS.
Run: `cd frontend && npm run build` — exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Skeleton.tsx frontend/src/components/Skeleton.test.tsx frontend/src/components/AsyncBoundary.tsx frontend/src/components/AsyncBoundary.test.tsx frontend/src/components/EmptyState.tsx frontend/src/components/EmptyState.test.tsx frontend/src/theme.css
git commit -m "Add Skeleton / AsyncBoundary / EmptyState + their CSS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `ToastContext` + provider + CSS

**Files:**
- Create: `frontend/src/context/ToastContext.tsx` + `.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/theme.css`

- [ ] **Step 1: Write the failing test**

`frontend/src/context/ToastContext.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastContext.js';

function Trigger() {
  const { toast } = useToast();
  return (
    <div>
      <button onClick={() => toast('success', 'salvo')}>ok</button>
      <button onClick={() => toast('error', 'falhou')}>err</button>
    </div>
  );
}

afterEach(() => vi.useRealTimers());

describe('ToastContext', () => {
  it('shows a toast in a live region and stacks a second', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('err'));
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('salvo');
    expect(region).toHaveTextContent('falhou');
  });

  it('a toast can be dismissed and auto-dismisses after 3.5s', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    act(() => {
      screen.getByText('ok').click();
    });
    expect(screen.getByText('salvo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByText('salvo')).not.toBeInTheDocument();

    act(() => {
      screen.getByText('err').click();
    });
    expect(screen.getByText('falhou')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3600);
    });
    expect(screen.queryByText('falhou')).not.toBeInTheDocument();
  });

  it('useToast throws outside a provider', () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ToastProvider/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/context/ToastContext.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `ToastContext.tsx`**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastKind = 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; message: string }

interface ToastContextValue {
  toast: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);
const DISMISS_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setItems((xs) => [...xs, { id, kind, message }]);
      setTimeout(() => remove(id), DISMISS_MS);
    },
    [remove],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`}>
            <span>{t.message}</span>
            <button type="button" aria-label="Fechar" onClick={() => remove(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
```

- [ ] **Step 4: Mount in `App.tsx`**

```tsx
import { ToastProvider } from './context/ToastContext.js';
// …
export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <Router />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 5: Add the CSS**

Append to `frontend/src/theme.css`:

```css
/* ---- toasts ---- */
.toast-region {
  position: fixed;
  left: 50%;
  bottom: var(--space-5);
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  z-index: 100;
  width: max-content;
  max-width: min(90vw, 420px);
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: var(--text-sm);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  animation: toast-in 0.16s ease-out;
}
.toast--success { border-left: 3px solid var(--success); }
.toast--error { border-left: 3px solid var(--danger); }
.toast button {
  background: none;
  border: none;
  color: var(--text-subtle);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .toast { animation: none; }
}
@media (max-width: 600px) {
  .toast-region { left: var(--space-3); right: var(--space-3); transform: none; width: auto; max-width: none; }
}
```

- [ ] **Step 6: Run to verify it passes + `App.test.tsx`**

Run: `cd frontend && npx vitest run src/context/ToastContext.test.tsx src/App.test.tsx`
Expected: PASS (`App.test` renders `<App />`, which now includes
`ToastProvider` — no change needed there).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/context/ToastContext.tsx frontend/src/context/ToastContext.test.tsx frontend/src/App.tsx frontend/src/theme.css
git commit -m "Add ToastContext (aria-live region, auto-dismiss) + mount in App

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `<Field>` component

**Files:**
- Create: `frontend/src/components/Field.tsx` + `.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/components/Field.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './Field.js';

describe('Field', () => {
  it('associates the label, shows hint and error when present', () => {
    const { rerender } = render(
      <Field label="Valor" htmlFor="v" hint="Ex.: 1.234,56">
        <input id="v" />
      </Field>,
    );
    expect(screen.getByLabelText('Valor')).toBeInTheDocument();
    expect(screen.getByText('Ex.: 1.234,56')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(
      <Field label="Valor" htmlFor="v" error="Valor inválido">
        <input id="v" />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Valor inválido');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/Field.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `Field.tsx`**

```tsx
import type { ReactNode } from 'react';

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error && <span className="subtle">{hint}</span>}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/Field.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Field.tsx frontend/src/components/Field.test.tsx
git commit -m "Add <Field> — label + control + hint + inline error

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## The page-migration recipe (Tasks 5–7)

Every page migration applies the same transform. Per file:

**A. Data → `useResource`.** Delete the fetched-data `useState`(s), the
`load`/`refresh` function, and its `useEffect`. Add:

```ts
const r = useResource(() => <the old load body, returning the value(s)>, [<deps>]);
```

For a single fetch: `useResource(() => api.listIncome(), [])`. For
several: `useResource(() => Promise.all([api.a(), api.b()]), [dep])` and
destructure `const [a, b] = r.data ?? [null, null]` inside the boundary.

**B. Wrap the body.** Keep `<h1 className="page-title">…</h1>` (and the
form, if the page's form should stay usable during a list reload —
default: keep forms outside the boundary too, only the list/summary
goes inside). Wrap the list/summary section:

```tsx
<AsyncBoundary loading={r.loading} error={r.error} onRetry={r.reload}>
  {/* uses r.data — guaranteed non-null here */}
</AsyncBoundary>
```

**C. Mutations.** Replace `await refresh()` with `r.reload()`. On
success add `toast('success', '<msg>')`; on a caught failure replace
`setError(msg)` with `toast('error', msg)`.

**D. Empty branch.** Replace
`{items.length === 0 && <p style={{color:'var(--text3)'}}>Nenhum …</p>}`
with `{items.length === 0 && <EmptyState message="Nenhum … ainda." />}`
(add an `action` where the spec's list says so — Metas/Projetos/Receitas
get a "criar o primeiro" that focuses the form via a ref; the rest just
the message this slice).

**E. Remove the page-level `error` state entirely.**

**Per-file test transform:**
- `import { renderWithToast } ...` — add a tiny helper at the top of the
  file (or wrap inline): `const renderWithToast = (ui) => render(<ToastProvider>{ui}</ToastProvider>)`.
  Replace `render(<Page />)` with `renderWithToast(<Page />)`.
- Any test whose **first** DOM assertion is a synchronous `getBy…`
  right after `render` → change that assertion to `await screen.findBy…`
  (the page shows a skeleton first). Assertions that already sit after
  an `await` in the same test are fine.
- A test that asserted the old error paragraph for an **action failure**
  (e.g. "shows an error when the delete request fails" →
  `findByText('unauthorized')`) still works — the toast renders that
  text; it just needs the `ToastProvider` wrap.
- A test asserting an empty-list message (`getByText('Nenhum lançamento
  ainda.')`) still works — `<EmptyState>` renders the same string.

---

## Task 5: Migrate the list pages — Receitas, Câmbio, Gastos, Parcelas

**Files:** `frontend/src/pages/{Receitas,Cambio,Gastos,Parcelas}Page.tsx`
+ their `.test.tsx`.

- [ ] **Step 1: Migrate `ReceitasPage`** per the recipe.
  - `useResource(() => api.listIncome(), [])`.
  - List section (the entries table) inside `<AsyncBoundary>`; the add
    form stays above it.
  - `handleSubmit` success → `toast('success', 'Receita adicionada')` +
    reset + `r.reload()`; failure → `toast('error', message)`.
  - `handleDelete` failure → `toast('error', message)` (was
    `setError`); success → `r.reload()`.
  - Empty → `<EmptyState message="Nenhum lançamento ainda." />`.
- [ ] **Step 2: Update `ReceitasPage.test.tsx`** per the test transform.
  Run: `cd frontend && npx vitest run src/pages/ReceitasPage.test.tsx` → PASS.
- [ ] **Step 3: Migrate `CambioPage`** (`useResource(() =>
  api.listExchangeContracts(), [])`; the contract list inside the
  boundary; keep the live spread/VET preview and the form above).
  Update `CambioPage.test.tsx`. → PASS.
- [ ] **Step 4: Migrate `GastosPage`** (`useResource(() =>
  api.listExpenses(), [])`; the expense list + totals inside the
  boundary; `FixedExpensesSection` / `CategoryRulesSection` /
  `StatementImportSection` stay below, untouched here; the
  "Categorizar pendentes" sweep result becomes a toast). Update
  `GastosPage.test.tsx`. → PASS.
- [ ] **Step 5: Migrate `ParcelasPage`** (`useResource(() =>
  api.listExpenses(), [])` then `groupInstallments(...)` on `r.data`;
  the table inside the boundary; empty → `<EmptyState message="Nenhuma
  compra parcelada." />`). Update `ParcelasPage.test.tsx`. → PASS.
- [ ] **Step 6: Run the 4 suites + tsc + build**

Run: `cd frontend && npx vitest run src/pages/ReceitasPage.test.tsx src/pages/CambioPage.test.tsx src/pages/GastosPage.test.tsx src/pages/ParcelasPage.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ReceitasPage.tsx frontend/src/pages/ReceitasPage.test.tsx frontend/src/pages/CambioPage.tsx frontend/src/pages/CambioPage.test.tsx frontend/src/pages/GastosPage.tsx frontend/src/pages/GastosPage.test.tsx frontend/src/pages/ParcelasPage.tsx frontend/src/pages/ParcelasPage.test.tsx
git commit -m "Migrate Receitas/Câmbio/Gastos/Parcelas to useResource + AsyncBoundary + toasts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Migrate — Reserva, Metas, Projetos, Histórico Dólar

**Files:** `frontend/src/pages/{Reserva,Metas,Projetos,HistoricoDolar}Page.tsx`,
`frontend/src/components/TargetSection.tsx` + tests.

- [ ] **Step 1: Migrate `ReservaPage`.**
  `useResource(() => Promise.all([api.listEmergencyFund(),
  api.listExpenses(), api.getMonthlyTarget(month)]), [month])`.
  `const [entries, expenses, target] = r.data ?? [null, null, null]`.
  Status card + ledger inside `<AsyncBoundary>`; the three forms
  (deposit / withdraw / meta) stay outside so they work during a
  reload. Mutations → `r.reload()` + toasts. Empty ledger →
  `<EmptyState message="Nenhum lançamento ainda." />`.
  Update `ReservaPage.test.tsx`.
- [ ] **Step 2: Migrate `TargetSection`** (shared by Metas &
  Projetos). `useResource(() => api.<targetsApi>.list(), [])`.
  List inside the boundary; add form outside; delete/add/patch →
  `r.reload()` + toast. Empty →
  `<EmptyState message="Nenhuma meta ainda." action={<button …>Criar a primeira</button>} />`
  (button focuses the name input via a ref). Update `TargetSection.test.tsx`
  and, if they render it, `MetasPage.test.tsx` / `ProjetosPage.test.tsx`
  (add the `ToastProvider` wrap).
- [ ] **Step 3: Migrate `HistoricoDolarPage`.**
  `useResource(() => api.listDollarQuotes(), [])`. Chart + table inside
  the boundary; the upsert form outside. Empty →
  `<EmptyState message="Nenhuma cotação registrada." />`. Mutations →
  toast + reload. Update `HistoricoDolarPage.test.tsx`.
- [ ] **Step 4: Run the suites + tsc**

Run: `cd frontend && npx vitest run src/pages/ReservaPage.test.tsx src/pages/MetasPage.test.tsx src/pages/ProjetosPage.test.tsx src/pages/HistoricoDolarPage.test.tsx src/components/TargetSection.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ReservaPage.tsx frontend/src/pages/ReservaPage.test.tsx frontend/src/components/TargetSection.tsx frontend/src/components/TargetSection.test.tsx frontend/src/pages/MetasPage.test.tsx frontend/src/pages/ProjetosPage.test.tsx frontend/src/pages/HistoricoDolarPage.tsx frontend/src/pages/HistoricoDolarPage.test.tsx
git commit -m "Migrate Reserva/Metas/Projetos/Histórico Dólar to useResource + AsyncBoundary + toasts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Migrate — Dashboard, Análise, Backup & Dados

**Files:** `frontend/src/pages/{Dashboard,Analise,BackupDados}Page.tsx` + tests.

- [ ] **Step 1: Migrate `DashboardPage`.**
  `useResource(() => api.getDashboard(month), [month])`. Everything
  below the `<h1>` inside `<AsyncBoundary skeletonRows={6}>`; drop the
  local `summary`/`error` state and the `load` fn. The monthly-close
  toggle's `markMonthReviewed`/`unmark` → on success `r.reload()`;
  no toast needed (the checkbox state is the feedback) — but a failed
  toggle → `toast('error', message)`.
  Update `DashboardPage.test.tsx`: wrap in `ToastProvider`; the "renders
  the stat cards…" tests already `await findByText`; **add** a test:
  `getDashboard` rejects → `findByRole('button', { name: 'Recarregar' })`
  present, clicking it calls `getDashboard` again.
- [ ] **Step 2: Migrate `AnalisePage`.**
  `useResource(() => Promise.all([api.listIncome(), api.listExpenses(),
  api.listEmergencyFund(), api.getMonthlyTarget(month), api.goalsApi.list(),
  api.projectsApi.list()]), [month])`. The deterministic-analysis cards
  inside `<AsyncBoundary skeletonRows={4}>`. `<ConsultorIA />` and
  `<AiUsageSection />` stay **outside** the boundary (they own their
  own fetches / loading) — this slice does not touch them beyond the
  `ToastProvider` wrap their tests already need.
  Update `AnalisePage.test.tsx` (wrap; first assertion `await findBy`).
- [ ] **Step 3: Migrate `BackupDadosPage`.**
  `useResource(() => Promise.all([api.getDiagnostics(),
  api.listMonthlyClose()]), [])`. Diagnostics + monthly-close list
  inside `<AsyncBoundary>`; the export/import/danger-zone controls stay
  outside. The existing `status` string for "N gastos aplicados / dados
  importados" → keep as-is *or* convert to toast (convert: it's an
  action result). Wipe/seed/import success → `toast('success', …)` +
  `r.reload()`; failure → `toast('error', …)`. Remove the `error`
  state. Update `BackupDadosPage.test.tsx`.
- [ ] **Step 4: Run the suites + tsc + full frontend suite**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.tsx src/pages/AnalisePage.test.tsx src/pages/BackupDadosPage.test.tsx src/App.test.tsx`
Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all green, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/pages/DashboardPage.test.tsx frontend/src/pages/AnalisePage.tsx frontend/src/pages/AnalisePage.test.tsx frontend/src/pages/BackupDadosPage.tsx frontend/src/pages/BackupDadosPage.test.tsx
git commit -m "Migrate Dashboard/Análise/Backup to useResource + AsyncBoundary + toasts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Forms → `<Field>` + blur validation

**Files:** `frontend/src/pages/{Receitas,Cambio,Gastos,Reserva,HistoricoDolar}Page.tsx`,
`frontend/src/pages/LoginPage.tsx`, `frontend/src/components/{TargetSection,TargetCard,FixedExpensesSection,CategoryRulesSection}.tsx`
+ tests.

**Recipe per validated form** (Receitas, Câmbio, Gastos, Reserva ×3,
Histórico Dólar):

- `const f = useFormErrors();`
- Wrap each control: `<Field label="Valor (R$)" htmlFor="rec-amount"
  error={f.errors.amount}><input id="rec-amount" className="field-input"
  aria-invalid={!!f.errors.amount} onBlur={validateAmount} … /></Field>`.
- Named validators, e.g.:
  ```ts
  function validateAmount() {
    const c = parseCentsFromInput(amount);
    if (Number.isNaN(c) || c <= 0) f.setError('amount', 'Valor inválido');
    else f.clearError('amount');
  }
  ```
- `handleSubmit`: run every validator, `if (f.hasErrors) return;`, then
  the `api.create…` call → `toast('success', …)` on success.
- The existing single-`setError('Valor inválido')` lines are deleted;
  their intent now lives in the per-field validators.

**Trivial forms** (`LoginPage`, `TargetSection` add form, `TargetCard`
edit, `FixedExpensesSection`, `CategoryRulesSection`): just wrap
controls in `<Field>` for consistent spacing/labels; keep their current
minimal validation; a failed submit → `toast('error', message)` where
they previously set an inline string (except LoginPage, which keeps its
one inline error).

- [ ] **Step 1:** Receitas + its test (label names unchanged, so
  `getByLabelText('Valor (R$)')` etc. still resolve; add a test:
  blurring "Valor (R$)" with `abc` shows "Valor inválido" under the
  field; a good submit shows a success toast).
- [ ] **Step 2:** Câmbio + test (10 fields; group with `<Field>`; the
  live preview logic is unchanged; add a blur-validation test for the
  USD amount and the rate).
- [ ] **Step 3:** Gastos + test.
- [ ] **Step 4:** Reserva (3 forms) + test.
- [ ] **Step 5:** Histórico Dólar + test.
- [ ] **Step 6:** LoginPage, TargetSection, TargetCard,
  FixedExpensesSection, CategoryRulesSection — `<Field>` wrap only +
  toast-on-action-failure; update each test (`ToastProvider` wrap; the
  couple that assert an inline action error now assert the toast text).
- [ ] **Step 7: Full frontend suite + tsc + build**

Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm run build`
Expected: all green, no type errors, build exit 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/ReceitasPage.tsx frontend/src/pages/ReceitasPage.test.tsx frontend/src/pages/CambioPage.tsx frontend/src/pages/CambioPage.test.tsx frontend/src/pages/GastosPage.tsx frontend/src/pages/GastosPage.test.tsx frontend/src/pages/ReservaPage.tsx frontend/src/pages/ReservaPage.test.tsx frontend/src/pages/HistoricoDolarPage.tsx frontend/src/pages/HistoricoDolarPage.test.tsx frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.test.tsx frontend/src/components/TargetSection.tsx frontend/src/components/TargetSection.test.tsx frontend/src/components/TargetCard.tsx frontend/src/components/TargetCard.test.tsx frontend/src/components/FixedExpensesSection.tsx frontend/src/components/FixedExpensesSection.test.tsx frontend/src/components/CategoryRulesSection.tsx frontend/src/components/CategoryRulesSection.test.tsx
git commit -m "Forms: <Field> wrapper everywhere + blur validation on the 5 validated forms + toasts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: PDF import progress + Cancel

**Files:** `frontend/src/lib/api.ts`,
`frontend/src/components/StatementImportSection.tsx` + `.test.tsx`.

**Interfaces:**
- `importPreviewStatement(dataBase64, filename?, signal?: AbortSignal)`.

- [ ] **Step 1: Add the failing test**

In `StatementImportSection.test.tsx`, add:

```tsx
  it('shows elapsed time and a Cancelar button while reading, and cancels', async () => {
    let rejectAbort: (e: unknown) => void = () => {};
    vi.spyOn(api, 'importPreviewStatement').mockImplementation(
      (_b, _f, signal) =>
        new Promise((_res, rej) => {
          rejectAbort = rej;
          signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    );
    render(<StatementImportSection onImported={() => {}} />);
    const input = screen.getByLabelText('Arquivo do extrato') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['%PDF'], 'f.pdf', { type: 'application/pdf' })] },
    });

    expect(await screen.findByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByText(/há \d+s/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText(/Leitura cancelada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    void rejectAbort;
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/StatementImportSection.test.tsx`
Expected: FAIL — no Cancelar / elapsed text.

- [ ] **Step 3: Update `api.ts`**

```ts
export function importPreviewStatement(
  dataBase64: string,
  filename?: string,
  signal?: AbortSignal,
): Promise<{ rows: ImportPreviewRow[]; warnings: string[] }> {
  return request('/api/expenses/import-preview', {
    method: 'POST',
    body: JSON.stringify({ dataBase64, filename }),
    signal,
  });
}
```

(`request`'s `init` already spreads into `fetch`, so `signal` flows
through; add `signal?: AbortSignal` to the `RequestInit`-ish type only
if `request`'s param type is a hand-rolled interface — otherwise it's
`RequestInit` and already has it.)

- [ ] **Step 4: Update `StatementImportSection.tsx`**

- New state: `const [elapsed, setElapsed] = useState(0);` and
  `const abortRef = useRef<AbortController | null>(null);`
- In the read path: `const ac = new AbortController(); abortRef.current
  = ac; setElapsed(0); const started = Date.now();` start a
  `setInterval(() => setElapsed(Math.round((Date.now() - started) /
  1000)), 1000)` stored in a ref; call `api.importPreviewStatement(base64,
  file.name, ac.signal)`; clear the interval on resolve/reject.
- In `.catch`: `if ((err as DOMException).name === 'AbortError') return;`
  before the existing `mapError`.
- `function cancel() { abortRef.current?.abort(); clearInterval(intervalRef.current);
  setPhase('idle'); setResult('Leitura cancelada.'); }`
- `phase === 'reading'` render:

```tsx
<div style={{ marginTop: 10 }}>
  <div className="progress-indeterminate" aria-hidden="true"><span /></div>
  <p className="subtle" style={{ marginTop: 6 }}>
    Lendo o extrato com a IA — há {elapsed}s. Costuma levar 20–40 segundos.
  </p>
  <button type="button" className="btn btn-ghost btn-sm" onClick={cancel} style={{ marginTop: 6 }}>
    Cancelar
  </button>
  <span className="subtle" style={{ marginLeft: 8 }}>a leitura já iniciada não é reembolsada</span>
</div>
```

- Add to `theme.css`:

```css
.progress-indeterminate {
  height: 3px;
  background: var(--bg-sunken);
  border-radius: 2px;
  overflow: hidden;
}
.progress-indeterminate span {
  display: block;
  height: 100%;
  width: 40%;
  background: var(--accent);
  animation: progress-slide 1.1s ease-in-out infinite;
}
@keyframes progress-slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
@media (prefers-reduced-motion: reduce) {
  .progress-indeterminate span { animation: none; width: 100%; opacity: 0.5; }
}
```

- [ ] **Step 5: Run to verify it passes + full frontend suite**

Run: `cd frontend && npx vitest run src/components/StatementImportSection.test.tsx && npm test`
Expected: PASS; full suite green.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/StatementImportSection.tsx frontend/src/components/StatementImportSection.test.tsx frontend/src/theme.css
git commit -m "PDF import: indeterminate progress bar, elapsed timer, Cancelar (client abort)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Sweep, build, smoke, docs

**Files:** `docs/qa-checklist.md`, `README.md`.

- [ ] **Step 1: Full sweeps**

Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm run build` — all green, exit 0.
Run: `cd server && npm test` — unchanged, green.
Run: `bash scripts/qa-e2e.sh` — unchanged count, `0 failed`.

- [ ] **Step 2: Restart live server + browser smoke**

```bash
cd frontend && npm run build
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1.5
curl -s -o /dev/null -w 'home: %{http_code}\n' http://localhost:4173/
```

Manual: each page shows pulsing skeleton blocks then content; stop the
server, reload a page → an error card with a working **Recarregar**;
submit a form with a bad value → inline message under the field; a good
submit → a toast bottom-centre; the PDF import shows a sliding bar + a
seconds counter + **Cancelar** that returns to idle.

- [ ] **Step 3: Docs**

`docs/qa-checklist.md` — bump the frontend test count; add a
`## States & feedback (Phase 2.5.3)` section:

```markdown
- [x] `useResource` — loading → resolved / rejected(message) / reload
      re-runs / no setState after unmount (4 unit tests).
- [x] `AsyncBoundary` — skeleton while loading, error card + working
      Recarregar on failure, children when resolved (3 unit tests).
      `Skeleton` renders N blocks and is `aria-hidden` (unit).
      `EmptyState` shows message + optional action (unit).
- [x] `ToastContext` — `toast()` renders in a `role="status"` region,
      stacks, dismiss button removes one, auto-dismiss after 3.5s,
      `useToast` throws outside a provider (3 unit tests).
- [x] `<Field>` — label association, inline `role="alert"` error, hint
      (unit). `useFormErrors` set/clear/clearAll/hasErrors (unit).
- [x] All 11 pages load through `useResource` + `AsyncBoundary`; their
      existing behaviour tests pass with a `ToastProvider` wrap and the
      first assertion switched to `findBy`.
- [x] The 5 validated forms (Receitas, Câmbio, Gastos, Reserva,
      Histórico Dólar) validate per-field on blur and show a success
      toast on save; action failures are toasts, not inline strings.
- [x] PDF import shows an elapsed timer + Cancelar; Cancelar aborts the
      client fetch and returns to idle (unit).
- [ ] Browser: skeletons on every page load; kill the server, reload,
      Recarregar works; field error appears inline; success toast;
      import bar + timer + working Cancelar.
```

`README.md` — under Phase 2.5, mark 2.5.3 done; 2.5.2 (finish the
migration + nav + page-header) is next.

- [ ] **Step 4: Commit**

```bash
git add docs/qa-checklist.md README.md
git commit -m "States & feedback: docs + checklist"
```

---

## Self-Review

**Spec coverage**

| Spec item | Task |
|---|---|
| `useResource(loader, deps?)` — unmount-safe, stale-run guard, `reload` | 1 |
| `useFormErrors()` | 1 |
| `<Skeleton>` generic + `prefers-reduced-motion` | 2 |
| `<AsyncBoundary loading error onRetry>` — skeleton / error+Recarregar / children | 2 |
| `<EmptyState message action?>` | 2 |
| `ToastContext` / `useToast` — `aria-live`, auto-dismiss, dismiss button, stacks, throws outside provider | 3 |
| `ToastProvider` mounted above `AuthProvider` in `App` | 3 |
| `<Field label htmlFor error hint>` — assoc, `role="alert"`, hint | 4 |
| three-way feedback split applied to every page | 5, 6, 7, 8 |
| all 11 pages via `useResource` + `AsyncBoundary`; `<h1>` stays outside | 5, 6, 7 |
| list-empty → `<EmptyState>` (with `action` on Metas/Projetos/Receitas) | 5, 6 |
| mutations → `reload()` + success/failure toasts | 5–8 |
| 5 validated forms get blur validation; trivial forms get `<Field>` wrap only; Login keeps its inline error | 8 |
| `importPreviewStatement(…, signal?)` — only `api.ts` change | 9 |
| PDF import: indeterminate bar + elapsed + "20–40 s" + Cancelar (client abort, honest label) | 9 |
| all animations gated by `prefers-reduced-motion` | 2, 3, 9 |
| no server / e2e change | constraints + 10 |
| CSS: skeleton / async-error / empty-state / toast / progress + keyframes | 2, 3, 9 |
| docs + README | 10 |

**Placeholder scan:** no `TODO`/`TBD`. Tasks 5–8 use a shared
"page-migration recipe" instead of repeating the same transform 15×
(the recipe is explicit — every state removed, every wrapper added,
every test change named); each task step then calls out that file's
specifics (which fetches, which empty message, which `action`). All new
code (hooks, three components, context, `<Field>`, the import progress
block) is given in full.

**Type consistency:**
- `Resource<T>` `{ data, error, loading, reload }` — Task 1 def used
  identically by every page in Tasks 5–7 (`r.loading`, `r.error`,
  `r.reload`, `r.data`).
- `FormErrors` `{ errors, setError, clearError, clearAll, hasErrors }` —
  Task 1 def matches Task 8's `f.errors.x` / `f.setError` / `f.hasErrors`
  usage.
- `AsyncBoundary` props `{ loading: boolean; error: string | null;
  onRetry: () => void; skeletonRows?: number; children }` — Task 2 def
  matches every call site (`<AsyncBoundary loading={r.loading}
  error={r.error} onRetry={r.reload} skeletonRows={6}>`).
- `useToast()` → `{ toast: (kind: 'success'|'error', message: string)
  => void }` — Task 3 def matches every `toast('success', …)` /
  `toast('error', …)` call in Tasks 5–8.
- `<Field>` props `{ label: string; htmlFor: string; error?: string |
  null; hint?: string; children }` — Task 4 def matches Task 8's usage.
- `importPreviewStatement(dataBase64, filename?, signal?)` — Task 9
  `api.ts` signature matches the Task 9 component call and the Task 9
  test's `mockImplementation((_b, _f, signal) => …)`.
- `EmptyState` `{ message: string; action?: ReactNode }` — Task 2 def
  matches Tasks 5–6 usage.
