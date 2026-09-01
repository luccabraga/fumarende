# fumarende — states & feedback (Phase 2.5.3)

> **Phase 2.5, sub-slice 3 of ~5.** Phase 2 complete; 2.5.1 (design
> foundation) shipped; a batch of audit quick-wins shipped. This slice
> is driven by the UX audit
> (`artifact 34eccf89-…`): it fixes 3 of the 4 critical findings —
> nothing shows a loading state, forms are submit-then-error, and the
> PDF-import experience reads as frozen. Its own brainstorm → spec →
> plan cycle. 2.5.2 (finish the inline-style migration + page-header +
> nav) comes after and builds on the components introduced here.

## Context

Every page is built the same way: `useState` for the fetched data,
a `refresh()` / `load()` that awaits an API call and `setState`s,
`useEffect(refresh, [])`, and a single `error` string. There is **no
`loading` flag anywhere** — the page renders its empty shell
immediately, then the data "pops" in; on a slow phone that flash is
half a second of a broken-looking screen. Forms validate on submit and
surface one error string in an ad-hoc place. Successful actions give no
confirmation beyond the list re-rendering. The PDF import shows a static
"Lendo o extrato…" for 20–40 s with no progress and no way out.

This slice introduces the missing feedback layer and applies it to
all 11 pages.

Decisions from the 2026-09-01 brainstorm:

- **One slice, all four parts:** `AsyncBoundary` (loading / error), the
  `<EmptyState>` + toast system, `<Field>` + inline validation, and the
  PDF-import progress UI — applied to every page.
- **`useResource` hook:** replace the `useState / useEffect / refresh`
  trio on every page with one hook. Do the refactor properly, once.
- **Generic skeleton:** one `<Skeleton>` of pulsing blocks, not
  page-shaped.
- **PDF Cancel aborts the client only:** an `AbortController` frees the
  UI immediately; the server call finishes in the background (the
  reading is not refunded — the button label says so).

## Goals

- `useResource(loader, deps?)` → `{ data, error, loading, reload }`;
  unmount-safe; used by every page for its fetched data.
- `<AsyncBoundary loading error onRetry>{children}</AsyncBoundary>` —
  `<Skeleton>` while loading, an error card with **Recarregar**
  otherwise-or on failure, children when resolved.
- `<Skeleton>` — generic pulsing bars; static under
  `prefers-reduced-motion`; `aria-hidden`.
- `<EmptyState message action?>` — replaces the ~12 inline
  "Nenhum X ainda" paragraphs.
- `ToastContext` / `useToast()` — `toast('success' | 'error', message)`,
  a fixed `aria-live="polite"` region, auto-dismiss ≈ 3.5 s, click to
  dismiss. Provider at the top of `App`.
- `<Field label htmlFor error hint?>` + `useFormErrors()` — consistent
  labelled controls with an inline error slot; blur validation on the
  5 forms that have real validation logic.
- A clear **three-way feedback split** (below), applied consistently.
- PDF import: indeterminate bar + elapsed seconds + "20–40 s" note +
  **Cancelar** (client abort).

## Non-goals

- **No server change, no new endpoint, no e2e change.** Frontend only.
  (`importPreviewStatement` gains an optional `signal` param — that is
  the only `lib/api.ts` signature change.)
- **No page-shaped skeletons.** One generic component.
- **No redesign** of any page's content or layout — this slice adds the
  loading/error/empty/validation *states*, it does not move content.
  Layout work is 2.5.2 / 2.5.5.
- **No server-side streaming** for import progress. The bar is
  indeterminate; the timer is client-side.
- **No optimistic updates.** After a mutation the page still `reload()`s.
- **No form-library dependency.** `useFormErrors` is ~20 lines.
- The trivial forms (`CategoryRulesSection`, `FixedExpensesSection`)
  get the `<Field>` wrapper for consistency but **not** blur validation
  (they have almost none to do).
- `LoginPage` keeps its own tiny error handling (one field, one error) —
  it gets the `<Field>` wrapper only.

## Architecture

### The three-way feedback split

| Kind | Trigger | Where it renders |
|---|---|---|
| **Validation error** | a field value is invalid, before/at submit | inline, under the field, via `<Field error={…}>` |
| **Action failure** | the server rejects a create / edit / delete | a **toast** (`toast('error', message)`) |
| **Load failure** | the initial (or `reload`) fetch throws | the `<AsyncBoundary>` error card with **Recarregar** |

Every page is refactored to this split. The current single `error`
string per page is removed; its uses are routed to one of the three.

### `useResource` — `frontend/src/lib/useResource.ts`

```ts
export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useResource<T>(loader: () => Promise<T>, deps?: unknown[]): Resource<T>;
```

- On mount and whenever `deps` change: `loading = true`, run `loader()`.
  Success → `data` set, `loading = false`, `error = null`. Failure →
  `error = message` (`err instanceof Error ? err.message : 'Erro ao
  carregar'`), `loading = false`, `data` left as-is.
- `reload()` re-runs `loader()` with the same loading/error transitions.
- A `cancelled` ref guards against `setState` after unmount and against
  a stale in-flight `loader` resolving after a newer `reload` /
  `deps`-change (only the latest run may write state).
- `deps` defaults to `[]`. `loader` is expected to be an inline arrow
  (`() => api.listIncome()` or `() => Promise.all([...])`), re-created
  each render — the hook does **not** put `loader` in its effect deps;
  it re-runs on `deps` only. (Documented in a comment; every call site
  follows it.)

Pages with several fetches use one `useResource` with a `Promise.all`
loader; `data` is the tuple (e.g. `const r = useResource(() =>
Promise.all([api.listEmergencyFund(), api.listExpenses(),
api.getMonthlyTarget(month)]), [month])`).

### `<Skeleton>` — `frontend/src/components/Skeleton.tsx`

```tsx
export function Skeleton({ rows = 3 }: { rows?: number }): JSX.Element;
```

Renders a `<div aria-hidden="true" class="skeleton">` containing a wide
short bar (a faux title) then `rows` card-height blocks. `.skeleton__bar`
/ `.skeleton__block` use a `@keyframes skeleton-pulse` (opacity 0.5 → 1
→ 0.5, 1.4 s) defined in `theme.css`; under
`@media (prefers-reduced-motion: reduce)` the animation is removed and
the elements sit at a fixed 0.7 opacity. Colours from `--bg-sunken` /
`--border`.

### `<AsyncBoundary>` — `frontend/src/components/AsyncBoundary.tsx`

```tsx
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
}): JSX.Element;
```

- `loading && !error` → `<Skeleton rows={skeletonRows} />`.
- `error` (regardless of `loading`) → a `<div class="card async-error">`
  with the message and a `<button class="btn btn-ghost btn-sm">Recarregar</button>`
  that calls `onRetry`.
- else → `<>{children}</>`.

### `<EmptyState>` — `frontend/src/components/EmptyState.tsx`

```tsx
export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}): JSX.Element;
```

`<div class="empty-state">` — the message in `--text-subtle`, and
`action` (usually a `<button>` that focuses the create form or a link)
below it when given. Replaces every inline
`<p style={{ color: 'var(--text3)' }}>Nenhum …</p>`.

### Toasts — `frontend/src/context/ToastContext.tsx`

```ts
type ToastKind = 'success' | 'error';
interface ToastContextValue {
  toast: (kind: ToastKind, message: string) => void;
}
export function ToastProvider({ children }: { children: ReactNode }): JSX.Element;
export function useToast(): ToastContextValue;   // throws outside a provider
```

- State: a list of `{ id, kind, message }`. `toast()` pushes one with an
  incrementing id and schedules removal after 3500 ms.
- Renders a fixed region: `<div class="toast-region" role="status"
  aria-live="polite">` (bottom-centre on desktop, bottom full-width on
  mobile), each toast a `<div class="toast toast--success|error">` with
  the message and a dismiss `<button aria-label="Fechar">×</button>`.
- `ToastProvider` wraps `AuthProvider` inside `App` (so `/login` can
  toast too, and every page has it).
- `prefers-reduced-motion`: no slide-in, just appear.

### `<Field>` + `useFormErrors` — `frontend/src/components/Field.tsx`, `frontend/src/lib/useFormErrors.ts`

```tsx
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
  children: ReactNode;   // the control, with id={htmlFor}
}): JSX.Element;
```

Renders `<div class="field">` → `<label class="field-label"
for={htmlFor}>{label}</label>` → `children` → `hint` in
`<span class="subtle">` when set → `<span class="field-error"
role="alert">{error}</span>` when `error` is a non-empty string. The
control keeps `aria-invalid={!!error}` — the page sets that on the
input.

```ts
export interface FormErrors {
  errors: Record<string, string>;
  setError: (field: string, message: string) => void;
  clearError: (field: string) => void;
  clearAll: () => void;
  hasErrors: boolean;
}
export function useFormErrors(): FormErrors;
```

A `useState<Record<string,string>>({})` with the four mutators. A form's
per-field `onBlur` runs that field's check and calls
`setError(field, msg)` or `clearError(field)`; submit runs every check,
and proceeds only if `!hasErrors`.

### Page migration

**Every page** (`ReceitasPage`, `CambioPage`, `GastosPage`,
`ParcelasPage`, `ReservaPage`, `MetasPage` / `TargetSection`,
`ProjetosPage`, `AnalisePage`, `HistoricoDolarPage`, `DashboardPage`,
`BackupDadosPage`):

1. Replace the fetched-data `useState` + `useEffect` + `refresh`/`load`
   with `const r = useResource(() => …, [deps])`.
2. Wrap the page body in `<AsyncBoundary loading={r.loading}
   error={r.error} onRetry={r.reload}>…</AsyncBoundary>`. The
   `<h1 className="page-title">` stays **outside** the boundary so the
   title is always visible.
3. Read `r.data` for the list/summary; a `null`/loading `data` is only
   reached inside `children` after `loading` is false, so `r.data!` is
   safe there (or an early `if (!r.data) return null` guard inside).
4. Mutations (create/delete/toggle) call `r.reload()` instead of the old
   `refresh()`, and on success `toast('success', '…')`, on failure
   `toast('error', message)`.
5. List-empty branches render `<EmptyState message="Nenhum … ainda."
   action={…} />` instead of the inline paragraph.

**Forms with validation** — `ReceitasPage`, `CambioPage`, `GastosPage`,
`ReservaPage`, `HistoricoDolarPage`:

6. Wrap each control in `<Field>`; move the existing `if
   (Number.isNaN(…)) setError('Valor inválido')` checks into named
   per-field validators called on `blur` and again on submit via
   `useFormErrors`.
7. On a successful save → `toast('success', 'Receita adicionada' | …)`;
   reset the form; `r.reload()`.

**Trivial forms** — `CategoryRulesSection`, `FixedExpensesSection`,
`LoginPage`, `TargetCard` edit form: `<Field>` wrapper only, keep their
current minimal validation.

### PDF import progress — `frontend/src/components/StatementImportSection.tsx`

- `phase === 'reading'` renders:
  - an indeterminate bar: `<div class="progress-indeterminate">` (a CSS
    sliding highlight, static under `prefers-reduced-motion`);
  - `há {elapsed}s` — `elapsed` from a `useState(0)` + `useEffect`
    `setInterval(…, 1000)` started when the read begins, cleared on
    resolve/abort;
  - "a leitura costuma levar 20–40 segundos";
  - `<button class="btn btn-ghost btn-sm" onClick={cancel}>Cancelar</button>`
    with a `subtle` note: "a leitura já iniciada não é reembolsada".
- `cancel()` calls `abortRef.current?.abort()` and sets
  `phase = 'idle'`, `result = 'Leitura cancelada.'`.
- The read: `const ac = new AbortController(); abortRef.current = ac;`
  then `api.importPreviewStatement(base64, file.name, ac.signal)`. On an
  `AbortError` the `.catch` sets nothing extra (cancel already did);
  any other error → the existing `mapError`.

`frontend/src/lib/api.ts`:

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

`request()` already spreads `init` into `fetch`, so `signal` flows
through with no other change. (`request`'s non-2xx branch never runs on
an abort — `fetch` rejects with `AbortError` first.)

### `theme.css` additions

`.skeleton*` + `@keyframes skeleton-pulse`; `.async-error`;
`.empty-state`; `.toast-region` / `.toast` / `.toast--success` /
`.toast--error` (+ their reduced-motion + mobile rules);
`.field-error` already exists — add `role="alert"` styling is n/a, it's
just colour; `.progress-indeterminate` + its keyframe. All colours from
existing tokens (`--danger`, `--success`, `--bg-sunken`, `--border`,
`--accent`).

## Data flow

1. A page mounts → `useResource` sets `loading`, calls its loader.
2. `<AsyncBoundary>` shows `<Skeleton>`; the `<h1>` is already visible.
3. Loader resolves → `loading` false, `data` set → `children` render
   with the real content; an empty list shows `<EmptyState>`.
4. Loader rejects → `AsyncBoundary` shows the error card; **Recarregar**
   calls `r.reload()` → back to step 2.
5. A form submit: per-field validators (`useFormErrors`) gate it;
   invalid → inline `<Field error>`; valid → `api.createX()` → on
   success `toast('success', …)` + `r.reload()`; on failure
   `toast('error', message)`.
6. PDF import: `reading` phase shows the bar + timer + Cancelar;
   Cancelar aborts the fetch and returns to `idle`.

## Error handling

| Situation | Behaviour |
|---|---|
| Initial fetch fails | `AsyncBoundary` error card + Recarregar; the `<h1>` stays |
| `reload()` fails | same card replaces the content |
| Mutation rejected by server | `toast('error', message)`; the form keeps its values |
| Field value invalid | `<Field error>` under that field; submit blocked; no toast |
| PDF read aborted | `phase='idle'`, "Leitura cancelada.", no toast |
| PDF read fails (non-abort) | existing `mapError` message inline |
| `useToast` / `useResource` misuse | `useToast` throws outside a provider; `useResource` is a plain hook (no provider) |
| `localStorage` etc. | unchanged — not touched here |

## Testing

**New unit tests:**

- `lib/useResource.test.tsx` — a probe component: starts `loading:true`,
  `data:null`; resolves → `loading:false`, `data` set; a rejecting
  loader → `error` message, `loading:false`; `reload()` re-runs and
  flips `loading` again; unmounting mid-flight then resolving does not
  throw / warn.
- `components/Skeleton.test.tsx` — renders `rows` blocks; the wrapper is
  `aria-hidden`.
- `components/AsyncBoundary.test.tsx` — `loading` → a skeleton present,
  children absent; `error` → the message + a **Recarregar** button that
  calls `onRetry`; neither → children shown.
- `components/EmptyState.test.tsx` — message shown; `action` node
  rendered when passed, absent otherwise.
- `context/ToastContext.test.tsx` — `toast('success','x')` puts "x" in a
  `role="status"` region; a second toast stacks; the dismiss button
  removes one; `vi.useFakeTimers()` → it auto-dismisses after 3500 ms;
  `useToast()` outside a provider throws.
- `components/Field.test.tsx` — `label` is associated with the child
  control (`getByLabelText`); `error` string renders in a
  `role="alert"`; `hint` renders; no error node when `error` is
  null/empty.
- `lib/useFormErrors.test.tsx` — `setError`/`clearError`/`clearAll`
  update `errors` and `hasErrors`.

**Changed page tests (all 11 + `TargetSection`, `FixedExpensesSection`,
`CategoryRulesSection`, `ConsultorIA`, `AiUsageSection`,
`StatementImportSection`):**

- Wrap every `render(...)` in `<ToastProvider>` (a small
  `renderWithProviders` helper per file, or inline). Components that
  don't call `useToast` still need it if a child does.
- The first content assertion in each test becomes `await
  screen.findBy…` (the page shows a skeleton first). Assertions that
  already follow an `await findBy` in the same test are unaffected.
- Tests that asserted on the old single `error` paragraph for an
  **action** failure now assert on the toast text
  (`await screen.findByText(/…/)` inside the `role="status"` region);
  tests for a **validation** error assert the `<Field>` inline message;
  tests for a **load** failure assert the `AsyncBoundary` card +
  Recarregar.
- `DashboardPage.test.tsx` / `App.test.tsx` — `getDashboard` is mocked
  async; the "renders …" tests already use `findBy`. Add the
  `ToastProvider` wrap; add a test that a rejected `getDashboard` shows
  **Recarregar** and clicking it re-calls `getDashboard`.
- `StatementImportSection.test.tsx` — add: while `reading`, an elapsed
  counter and a **Cancelar** button render; clicking **Cancelar** aborts
  (the `importPreviewStatement` mock is called with a signal; the
  component returns to the idle state and shows "Leitura cancelada.").

**Build:** `cd frontend && npm run build` exit 0; CSS grows a little.
Server suite and `scripts/qa-e2e.sh` unchanged (frontend-only slice) —
run both to confirm no accidental coupling.

**Manual (browser):** every page shows pulsing skeleton blocks on load,
then content; kill the network and reload a page → an error card with
**Recarregar** that works when the network is back; submit a form with a
bad value → the message appears under that field; submit a good one →
a toast; the PDF import shows a moving bar + a seconds counter + a
working **Cancelar**.

## Files

**New:**
- `frontend/src/lib/useResource.ts` + `.test.tsx`
- `frontend/src/lib/useFormErrors.ts` + `.test.tsx`
- `frontend/src/components/Skeleton.tsx` + `.test.tsx`
- `frontend/src/components/AsyncBoundary.tsx` + `.test.tsx`
- `frontend/src/components/EmptyState.tsx` + `.test.tsx`
- `frontend/src/components/Field.tsx` + `.test.tsx`
- `frontend/src/context/ToastContext.tsx` + `.test.tsx`

**Modified:**
- `frontend/src/App.tsx` — mount `<ToastProvider>`
- `frontend/src/lib/api.ts` — `importPreviewStatement(…, signal?)`
- `frontend/src/theme.css` — skeleton / async-error / empty-state /
  toast / progress classes + two keyframes
- all 11 `frontend/src/pages/*.tsx` + their `*.test.tsx`
- `frontend/src/components/TargetSection.tsx`,
  `FixedExpensesSection.tsx`, `CategoryRulesSection.tsx`,
  `StatementImportSection.tsx` + tests
- `frontend/src/components/ConsultorIA.test.tsx`,
  `AiUsageSection.test.tsx`, `NavShell` is unaffected (no fetch of its
  own beyond `MonthContext`, which is out of scope)
- `docs/qa-checklist.md`, `README.md`

## Security / privacy notes

- No new network surface. The only API change is an `AbortSignal`
  passed through to the existing `/api/expenses/import-preview` call;
  aborting stops the browser waiting but the server request is not
  cancelled server-side and its Claude call still completes and is
  billed (the Cancelar label states this).
- Toasts render server-provided error strings as text (never as HTML) —
  same as the existing `error-text` usage.
