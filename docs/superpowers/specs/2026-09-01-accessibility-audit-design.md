# Accessibility Audit — Design (Phase 2.5.4)

**Status:** approved 2026-09-01. Frontend only. No new dependency, no
behaviour change beyond the a11y affordances below, no visual redesign
(five light-theme token values are nudged darker to clear WCAG AA).

## Problem

The app is keyboard-operable and has form labels + a reduced-motion
story, but a targeted pass found concrete WCAG 2.1 AA gaps:

- **No skip link** — a keyboard user tabs through the whole sidebar on
  every page.
- **Landmarks under-described** — `<nav>` has no accessible name;
  `<main>` has no `id` / programmatic focus target; the hamburger has
  no `aria-expanded` / `aria-controls`.
- **Focus not visible on every control** — the `:focus-visible` rule
  lists `.btn` / `.field-input` / `select` / `a`, missing the ~11
  inline link-style buttons (the item deferred from 2.5.2),
  checkboxes, range and file inputs.
- **Disclosure widgets are silent** — the "Histórico" (ConsultorIA) and
  "Últimas chamadas" (AiUsageSection) toggles convey open/closed only
  with a `▾ / ▸` glyph.
- **Form errors not associated** — `role="alert"` + `aria-invalid` are
  set, but the error text is not linked to its input via
  `aria-describedby`, so it is not read when focus returns to the
  field.
- **Data tables lack semantics** — `.data-table` `<th>` cells have no
  `scope`, and the tables have no caption.
- **Light-theme colour contrast fails AA** — on white / `#f7f6f3`:
  `--accent` `#0a8a78` ≈ 4.27 / 3.95 (button label text and
  accent-coloured text fail 4.5:1); `--danger` `#d63a58` ≈ 4.56 / 4.22
  (`.error-text` fails against the page background); `--warning`
  `#b3730f` ≈ 3.91; `--text-subtle` `#6b7280` ≈ 4.47 against `#f7f6f3`
  (`.subtle` is 11 px small text); `--success` `#1a9463` ≈ 3.85.
- **Route changes are silent** — focus stays on the clicked nav link
  and `document.title` never changes, so a screen-reader user gets no
  signal that the page changed.

## Goal

Close each gap with the smallest standard fix, add three utility
classes (`.skip-link`, `.sr-only`, `.link-btn`), retune five light
tokens (plus dark `--text-subtle`, which also fails), and lock the
contrast fix in with a computed test.

## Non-goals

- No new dependency — **no `jest-axe` / `vitest-axe`**. Verification is
  targeted unit assertions + a computed contrast test, matching the
  existing test style and the project's "fontsource is the only dep
  exception" rule.
- No visual redesign. The only colour change is five token values moving
  darker by a small amount to clear 4.5:1; layout, type, and spacing
  are untouched.
- No restructuring of the nav into a `<ul>` (the `NavLink`s in `<div
  className="nav__group">` are operable and labelled; a list wrapper is
  a possible later polish).
- No change to the toast live region (`role="status" aria-live="polite"`
  from 2.5.3 is correct).
- No full manual screen-reader sweep — that stays a human checklist
  item; this slice makes the programmatic affordances correct.

## 1. New CSS (`frontend/src/theme.css`)

```css
/* ---- a11y utilities (2.5.4) ---- */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.skip-link {
  position: absolute;
  left: var(--space-3);
  top: var(--space-3);
  z-index: 200;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text);
  text-decoration: none;
  transform: translateY(-150%);
}
.skip-link:focus {
  transform: translateY(0);
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--text-subtle);
  cursor: pointer;
}
.link-btn:hover {
  color: var(--text);
  text-decoration: underline;
}
```

**Broaden the focus rule.** Replace the current scoped selector list
with a bare `:focus-visible` (every focusable control, including
`.link-btn`, checkboxes, range and file inputs, and the programmatic
`<main tabIndex={-1}>` focus target):

```css
/* ---- focus ---- */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

## 2. Light-token contrast retune (`:root` in `theme.css`)

Ratios computed against `#ffffff` (cards) and `#f7f6f3` (page bg):

| Token | Was | New | vs `#fff` | vs `#f7f6f3` |
|---|---|---|---|---|
| `--accent` | `#0a8a78` | `#04756a` | 5.59 | 5.17 |
| `--danger` | `#d63a58` | `#c22a48` | 5.65 | 5.23 |
| `--warning` | `#b3730f` | `#875a0b` | 6.00 | 5.56 |
| `--text-subtle` | `#6b7280` | `#5c6370` | 6.05 | 5.59 |
| `--success` | `#1a9463` | `#0f7047` | 6.12 | 5.67 |

`--accent-contrast` stays `#ffffff`; `#04756a` + white = 5.59, so the
primary-button label clears AA. `--text-muted` (`#545a68`, 6.91) is
already fine.

## 3. Dark-token contrast retune

The dark `--accent` / `--danger` / `--warning` / `--success` are bright
values on near-black and already exceed 6:1 on the `#101016` card —
leave them. **`--text-subtle` fails in dark too** (`#565d6e` ≈ 2.88 on
`#101016`); raise it:

| Token | Was | New | vs `#101016` | vs `#08080b` |
|---|---|---|---|---|
| `--text-subtle` | `#565d6e` | `#7b8494` | 5.03 | 5.31 |

This value must be changed **identically in both** the
`:root[data-theme='dark']` block and the `@media (prefers-color-scheme:
dark) :root:not([data-theme='light'])` block (they are kept in sync by
hand; `theme.test.ts` asserts the two blocks declare the same property
names — unchanged here, only a value moves).

## 4. `theme.test.ts` — new tests

- **Vocabulary:** add `.skip-link`, `.sr-only`, `.link-btn` to the
  existing "defines the class vocabulary" list.
- **Computed contrast (new test):** parse the light `:root` block for
  `--accent`, `--danger`, `--warning`, `--text-subtle`, `--success`;
  compute the WCAG relative-luminance contrast ratio of each against
  `#ffffff` and against `#f7f6f3`; assert every ratio ≥ 4.5. Do the
  same for the `:root[data-theme='dark']` block's `--text-subtle`,
  `--text-muted` against `#101016` (≥ 4.5). A small `relLuminance()` /
  `contrastRatio()` helper lives in the test file.

## 5. Skip link + landmarks (`NavShell.tsx`)

- First child of `<div className="app">`, before `<nav>`:
  ```tsx
  <a href="#main" className="skip-link">Pular para o conteúdo</a>
  ```
- `<nav aria-label="Navegação principal" className={...}>`.
- The hamburger button gains `aria-expanded={menuOpen}` and
  `aria-controls="nav-list"`.
- `<div className="nav__list" id="nav-list">`.
- `<main className="main" id="main" tabIndex={-1}>` (the `id` is the
  skip-link and route-focus target; `tabIndex={-1}` makes it
  programmatically focusable without adding it to the tab order).

## 6. `.link-btn` rollout

Replace the repeated inline object
`{ background: 'none', border: 'none', padding: 0, fontSize: 12.5,
color: 'var(--text3)', cursor: 'pointer' }` with
`className="link-btn"` at every site:

- **Pages** (the "Excluir" row buttons): `ReceitasPage`, `CambioPage`,
  `GastosPage`, `ParcelasPage`, `ReservaPage`, `HistoricoDolarPage`.
- **Components:** `FixedExpensesSection` (Excluir), `CategoryRulesSection`
  (Excluir), `TargetCard` (the shared `ghostBtn` const → delete it,
  `className="link-btn"` on Adicionar / Editar / Excluir),
  `ConsultorIA` (the "Histórico" disclosure toggle),
  `AiUsageSection` (the "Últimas chamadas" disclosure toggle).

The `aria-label`s already on the Excluir buttons stay. The disclosure
toggles were `color: var(--text2)`; `.link-btn` uses `--text-subtle`
(now AA-compliant) — acceptable, no `--muted` variant.

## 7. Disclosure semantics

`ConsultorIA`:
```tsx
<button
  type="button"
  className="link-btn"
  aria-expanded={showHistory}
  aria-controls="consultor-history"
  onClick={() => setShowHistory((v) => !v)}
>
  {showHistory ? '▾' : '▸'} Histórico ({history.length})
</button>
{showHistory && (
  <div id="consultor-history" className="stack-sm" style={{ marginTop: 'var(--space-3)' }}>
    …
  </div>
)}
```

`AiUsageSection`: identical shape with `aria-controls="ai-usage-log"` on
the button and `id="ai-usage-log"` on the revealed `<div>`.

## 8. Form error association

**Id convention:** the inline error `<span className="field-error">` for
a control with `id="X"` gets `id="X-error"`, and the control gets
`aria-describedby="X-error"` **only while the error is present**
(`aria-describedby={f.errors.x ? 'X-error' : undefined}`).

- **`Field.tsx`:** the error span becomes
  `<span className="field-error" role="alert" id={`${htmlFor}-error`}>`.
  `Field` still does not touch the control (the page renders it), so the
  page adds `aria-describedby`.
- **`ReceitasPage`** (fully on `<Field>`): the amount and USD inputs get
  `aria-describedby={f.errors.amount ? 'rec-amount-error' : undefined}`
  etc.
- **`CambioPage`, `GastosPage`, `ReservaPage`, `HistoricoDolarPage`**
  (inline `<span className="field-error">`): give each error span
  `id="<input-id>-error"` and each validated input the matching
  conditional `aria-describedby`. Inputs: `cambio-amount-usd`,
  `cambio-rate`, `cambio-ptax`, `cambio-iof` + `cambio-bank-fee` (share
  `cambio-fees-error` — put the span once, point both inputs at it),
  `gasto-amount`, `gasto-installments`, `dep-amount`, `wd-amount`,
  `dol-rate`, `dol-salary`.

## 9. Data-table semantics

Two real `<table className="data-table">` remain: `HistoricoDolarPage`
and `StatementImportSection` (the AI-usage by-endpoint block is
`.list-row` divs, not a table).

- Every text `<th>` gets `scope="col"`.
- The empty header cells (checkbox / actions columns in the import
  table, the delete column in the dólar table) get
  `<th scope="col"><span className="sr-only">Ações</span></th>` /
  `<span className="sr-only">Incluir</span>`.
- Add `<caption className="sr-only">…</caption>` as the first child of
  each `<table>`: "Cotações mensais do dólar" / "Lançamentos do extrato
  para revisão".

## 10. Range slider value text (`AnalisePage`)

Each cut slider gets `aria-valuetext={`${cuts[c.category] ?? 0}%`}` so a
screen reader announces "50 %", not "50".

## 11. Route change — focus + title (`App.tsx`)

```tsx
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/receitas': 'Receitas',
  '/cambio': 'Câmbio',
  '/gastos': 'Gastos',
  '/parcelas': 'Parcelas',
  '/reserva': 'Reserva',
  '/metas': 'Metas',
  '/projetos': 'Projetos Especiais',
  '/analise': 'Análise',
  '/historico-dolar': 'Histórico Dólar',
  '/backup': 'Backup & Dados',
  '/login': 'Entrar',
};

function RouteEffects() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    const name = PAGE_TITLES[pathname];
    document.title = name ? `${name} · fumarende` : 'fumarende';
    if (first.current) {
      first.current = false; // don't steal focus on cold load
      return;
    }
    document.getElementById('main')?.focus();
  }, [pathname]);
  return null;
}
```

Rendered just inside `<BrowserRouter>`, as a sibling of `<Routes>`. On
`/login` there is no `#main`; `?.focus()` no-ops. `index.html`'s static
`<title>fumarende</title>` stays as the pre-hydration value.

## Files

**Modified:**
- `frontend/src/theme.css` — `.sr-only`, `.skip-link`, `.link-btn`,
  bare `:focus-visible`, 5 light tokens + 1 dark token retuned.
- `frontend/src/theme.test.ts` — vocab += 3, new computed-contrast test.
- `frontend/src/App.tsx` — `RouteEffects` + `PAGE_TITLES`.
- `frontend/src/components/NavShell.tsx` — skip link, `<nav>` label,
  `<main id tabIndex>`, hamburger `aria-expanded` / `aria-controls`,
  `#nav-list`.
- `frontend/src/components/Field.tsx` — error span `id`.
- `frontend/src/components/ConsultorIA.tsx` — `.link-btn`, disclosure
  `aria-expanded` / `aria-controls` / region `id`.
- `frontend/src/components/AiUsageSection.tsx` — same.
- `frontend/src/components/TargetCard.tsx` — drop `ghostBtn`,
  `.link-btn` ×3.
- `frontend/src/components/FixedExpensesSection.tsx`,
  `frontend/src/components/CategoryRulesSection.tsx` — `.link-btn`.
- `frontend/src/pages/{Receitas,Cambio,Gastos,Parcelas,Reserva,HistoricoDolar}Page.tsx`
  — `.link-btn` on Excluir; the four validated forms + Receitas add
  `aria-describedby`.
- `frontend/src/pages/HistoricoDolarPage.tsx`,
  `frontend/src/components/StatementImportSection.tsx` — `scope="col"`,
  `sr-only` header text, `<caption className="sr-only">`.
- `frontend/src/pages/AnalisePage.tsx` — slider `aria-valuetext`.

**No new source files.** New tests live in existing `*.test.tsx`
alongside the components they cover.

## Tests

- **`theme.test.ts`** — vocab assertion += `.skip-link` / `.sr-only` /
  `.link-btn`; new computed-contrast test (section 4).
- **`NavShell.test.tsx`** — a skip link with `href="#main"` renders and
  is the first focusable element; the hamburger's `aria-expanded`
  flips `false → true` on click and `aria-controls` matches the list's
  `id`.
- **`App.test.tsx`** — after navigating to `/receitas`,
  `document.title === 'Receitas · fumarende'` and
  `document.getElementById('main')` is (or contains) `document.activeElement`.
- **`ConsultorIA.test.tsx`** — the "Histórico" toggle exposes
  `aria-expanded` reflecting state and `aria-controls` pointing at the
  region that appears.
- **`Field.test.tsx`** — when `error` is set, the alert span has
  `id="<htmlFor>-error"`.
- **`ReceitasPage.test.tsx`** — a blurred-invalid amount input gets
  `aria-describedby` resolving to the visible error text.
- **`HistoricoDolarPage.test.tsx`** — the table's column headers carry
  `scope="col"`.
- Every existing page/component suite still passes unchanged (the
  `.link-btn` swap and ARIA additions don't touch queried text/roles;
  `getByRole('button', { name: 'Excluir …' })` still resolves).

## Verification

- `cd frontend && npm test` green; `tsc -p tsconfig.json --noEmit`
  clean; `npm run build` exit 0.
- `cd server && npm test` unchanged; `bash scripts/qa-e2e.sh` unchanged
  `0 failed`.
- `grep -rn "background: 'none'" frontend/src` returns nothing outside
  tests (all link-buttons now `.link-btn`).
- Rebuild + `launchctl kickstart` + browser:
  - Tab from a cold page load → the first stop is "Pular para o
    conteúdo"; activating it moves focus into the page body.
  - Every button, link, checkbox, slider, and file input shows the
    accent focus ring on keyboard focus.
  - The "Histórico" / "Últimas chamadas" toggles announce
    expanded/collapsed (VoiceOver).
  - Navigating between pages updates the browser tab title and moves
    focus to the main region.
  - Light theme: primary buttons, error text, and `.subtle` captions
    are visibly darker and legible on both card and page backgrounds;
    dark theme unchanged except slightly lighter `.subtle` text.
