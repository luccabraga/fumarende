# Styling Convention — Design (Phase 2.5.2)

**Status:** approved 2026-09-01. Frontend only. No server change, no new
dependency, no behaviour change, no token/colour change.

## Problem

Phase 2.5.1 gave the app a token system and a class vocabulary
(`theme.css`) but only migrated `NavShell`, `LoginPage`, and
`DashboardPage`. The other 17 files still carry ~180 inline `style={{}}`
props: repeated form-grid / list-row / data-table shapes, `h2Style` and
`fieldStyle` object literals, and dozens of one-off margins. The result
is inconsistent (section headings are 15px in some files, 16px in
others; card gaps vary 10/12/20/24px) and hard to restyle.

## Goal

Remove every inline `style={{}}` that is not a computed value, replacing
it with the class vocabulary — extended with seven primitives the app
genuinely repeats. Add a `<PageHeader>` component. Snap mismatched
sizes and gaps to the scale as part of the pass.

## Non-goals

- No `<Field>` rollout beyond swapping plain `<label style={fieldStyle}>`
  for `<label className="field-label">`. The validated-input `<Field>`
  work was Phase 2.5.3.
- No page-layout or grid redesign. Dashboard / Análise multi-column
  treatment is Phase 2.5.5.
- No changes to `theme.css` tokens or colours.
- No behaviour changes — every handler, fetch, and conditional stays.
- `NavShell` is untouched (fully migrated in 2.5.1).
- Computed inline styles stay inline: goal-bar `width: ${pct}%`
  (`DashboardPage`, `TargetCard`), and any genuinely one-off geometry.

## New / changed CSS (`frontend/src/theme.css`)

Append a `/* ---- page layout + shared shapes (2.5.2) ---- */` block.
All values come from the existing scales.

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.page-header__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.page-header__subtitle {
  color: var(--text-subtle);
  font-size: var(--text-sm);
  max-width: 60ch;
}
.page-header__actions {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.form-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: flex-end;
}

.list-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border);
}
.list-row:last-child {
  border-bottom: none;
}

.data-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--text-sm);
  line-height: 1.8;
}

.data-table {
  width: 100%;
  font-size: var(--text-sm);
  border-collapse: collapse;
}
.data-table th {
  text-align: left;
  color: var(--text-subtle);
  padding: 6px 8px;
  font-weight: 500;
}
.data-table td {
  padding: 6px 8px;
}
.data-table tbody tr {
  border-top: 1px solid var(--border);
}

.chart-svg {
  width: 100%;
  height: 80px;
}
```

Change to an existing rule:

```css
.page-title {
  font-family: var(--font-mono);
  font-size: var(--text-xl);
  /* margin-bottom removed — vertical rhythm now comes from .page /
     .page-header. LoginPage compensates with .stack on its card. */
}
```

## `<PageHeader>` component

`frontend/src/components/PageHeader.tsx`:

```tsx
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__row">
        <h1 className="page-title">{title}</h1>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
      {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
    </header>
  );
}
```

- `title` renders as the `<h1 className="page-title">` — every existing
  `getByRole('heading', { name: '<page name>' })` / `getByText` keeps
  resolving.
- `subtitle` renders only when a non-empty string is passed. Câmbio and
  Histórico Dólar have one today; the rest omit it.
- `actions` is an unused slot for now — no page passes it — but the
  markup and CSS exist so a later slice can add a header button without
  touching every page again.

## Per-file migration recipe

Applied uniformly. Per file:

1. Outer `<div>` → `<div className="page">`.
2. The `<h1 className="page-title">X</h1>` (plus an immediately-following
   grey descriptive `<p>`, if any) → `<PageHeader title="X" subtitle="…" />`.
3. `h2Style` object literal and inline `<h2 style={…}>` →
   `<h2 className="section-title">`; delete the `h2Style` const.
4. `<form className="card" style={{ …flex-wrap… }}>` →
   `<form className="card form-grid">`. Inside it, `<div><label
   style={fieldStyle}>Label</label><input className="field-input" …/></div>`
   → `<div className="field"><label className="field-label">Label</label>
   <input className="field-input" …/></div>`. Delete the `fieldStyle`
   const. (Inputs already carry `className="field-input"`.)
5. List/ledger rows — `<div style={{ display:flex; justifyContent:
   space-between; … borderBottom … }}>` → `<div className="list-row">`.
6. Tables — `<div style={{ overflowX:'auto' }}><table style={{ …
   borderCollapse … }}>` → `<div className="table-scroll"><table
   className="data-table">`; drop every `th`/`td` inline `padding` and
   the `tr` `borderTop`; drop the `<thead> <tr style={{ textAlign:'left',
   color:'var(--text3)' }}>` style (now in `.data-table th`).
7. Stacked label/value blocks — `<div style={{ fontSize:13,
   lineHeight:1.7 }}>` → `<div className="data-list">`. Full-width fixed
   inline SVGs — `<svg style={{ width:'100%', height:80 }}>` →
   `<svg className="chart-svg">`.
8. Small grey helper / caption text — `<p style={{ fontSize:12.5,
   color:'var(--text3)' }}>` → `<p className="subtle">`.
9. Remaining margins on page-level children are absorbed by `.page`'s
   `gap` — delete them. Margins *inside* a card between sub-elements:
   use `.stack` / `.stack-sm` on the card, or keep a single
   `style={{ marginTop: 'var(--space-3)' }}` only where a stack wrapper
   would be more disruptive than it's worth.
10. Delete now-unused `cardGap` / `h2Style` / `fieldStyle` / `cellInput`
    module constants.
11. Keep inline: computed `width: ${n}%`, and any single geometry value
    with no repeat and no class equivalent.

## Consistency fixes (in-scope)

- Section headings unify to `--text-lg` (16px) via `.section-title`.
  Files currently at 15px (`AnalisePage`, `BackupDadosPage`,
  `ConsultorIA`, `ReservaPage` Meta card, `TargetSection`) move up 1px.
- Card vertical gaps all become `--space-5` (24px) through `.page`.
  Previously 10 / 12 / 20 / 24.
- List-row vertical padding becomes `--space-3` (12px). Previously
  `10px`.
- Helper text becomes `.subtle` (`--text-xs`, 11px) — previously a mix
  of 12 / 12.5 / 13.
- Page subtitles become `.page-header__subtitle` (`--text-sm`, 12.5px).

## Files

**New (2):**
- `frontend/src/components/PageHeader.tsx`
- `frontend/src/components/PageHeader.test.tsx`

**Modified — `theme.css`** (append the block, edit `.page-title`).

**Modified — pages (11):**
`ReceitasPage`, `CambioPage`, `GastosPage`, `ParcelasPage`,
`ReservaPage`, `MetasPage`, `ProjetosPage`, `AnalisePage`,
`HistoricoDolarPage`, `BackupDadosPage`, `DashboardPage`.
(`MetasPage` / `ProjetosPage` carry no inline styles — they get only
the `.page` wrapper + `<PageHeader>`. `DashboardPage` was mostly
migrated in 2.5.1 — it gets `.page` + `<PageHeader>` and its two
remaining `style` props reviewed.)

**Modified — components (8):**
`ConsultorIA`, `AiUsageSection`, `TargetCard`, `TargetSection`,
`BarBreakdown`, `FixedExpensesSection`, `CategoryRulesSection`,
`StatementImportSection`.

**Modified — `LoginPage`:** add `stack` to its `.card` so the header
keeps spacing after `.page-title` loses its margin. (No `.page` wrapper —
login is a centred single card.)

## Tests

- **`PageHeader.test.tsx`** — `title` renders an `<h1>`; `subtitle`
  renders only when passed; an `actions` node renders inside
  `.page-header__actions` when passed.
- **Existing page/component suites** assert on text, role, and label —
  never on style literals — so they pass unchanged. The plan runs each
  affected suite after its file group and the full suite at the end;
  any breakage is a migration bug to fix in place, not an expected
  test rewrite.
- **`theme.test.ts`** — its class-vocabulary presence assertion gains
  the seven new names (`page`, `page-header`, `form-grid`, `list-row`,
  `data-list`, `data-table`, `chart-svg`).

## Verification

- `cd frontend && npm test` green; `./node_modules/.bin/tsc -p
  tsconfig.json --noEmit` clean; `npm run build` exit 0.
- `cd server && npm test` unchanged green; `bash scripts/qa-e2e.sh`
  unchanged `0 failed`.
- `grep -rn "style={{" frontend/src` returns only computed-value lines
  (goal-bar width, one-off geometry) — a short, enumerated list in the
  final commit message.
- Rebuild + `launchctl kickstart` + browser smoke: every page renders
  with the same content and spacing (±1px on the noted consistency
  fixes); light and dark both intact.
