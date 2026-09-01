# Styling Convention Implementation Plan (Phase 2.5.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every non-computed inline `style={{}}` from the 17
still-inline frontend files, replacing them with the `theme.css` class
vocabulary extended with seven layout primitives, and add a
`<PageHeader>` component.

**Architecture:** One `theme.css` block adds `.page` (vertical rhythm
wrapper), `.page-header*`, `.form-grid`, `.list-row`, `.data-list`,
`.data-table`, `.chart-svg`. A `<PageHeader title subtitle? actions?>`
component replaces every per-page `<h1>` + grey subtitle line. Each page
and shared component then follows one uniform migration recipe. Small
size/gap mismatches are snapped to the scale in passing. No behaviour,
token, or colour changes.

**Tech Stack:** React 18, React Router 6, Vite 6, Vitest
(+ `@testing-library/react`), plain CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-01-styling-convention-design.md`

## Global Constraints

- **Frontend only.** No server change, no new dependency, no
  `scripts/qa-e2e.sh` change, no `theme.css` token/colour change, no
  behaviour change (every handler, fetch, conditional, and ARIA
  attribute stays).
- **`NavShell` is untouched** — fully migrated in 2.5.1.
- **Kept inline** (the only allowed `style={{}}` after this slice):
  computed values — goal-bar `width: ${pct}%` (`DashboardPage`,
  `TargetCard`), and any single geometry value with no repeat and no
  class equivalent. Everything else becomes a class.
- **Consistency fixes are in-scope and expected:** section headings all
  become `--text-lg` (16px) via `.section-title` (some were 15px); card
  vertical gaps all become `--space-5` via `.page` (were 10/12/20/24);
  list-row padding becomes `--space-3` (was 10px); helper text becomes
  `.subtle`; page subtitles become `.page-header__subtitle`. ±1–2px
  shifts on these are the intended outcome, not regressions.
- **Existing tests assert on text / role / label, never on style
  literals** — they must pass unchanged. A breakage is a migration bug
  to fix in place, never an expected test rewrite.
- Frontend tests run from `frontend/`. Typecheck:
  `./node_modules/.bin/tsc -p tsconfig.json --noEmit` from `frontend/`.
- Branch `styling-convention` off `main`; the finishing skill merges it.
  One commit per task.

---

## Migration Recipe (applied by Tasks 3–9)

For each file, in order:

1. **Page wrapper.** Outer `return ( <div> … </div> )` →
   `<div className="page"> … </div>`. (Pages only — not sub-components
   that render into a page.)

2. **Header.** The `<h1 className="page-title">TITLE</h1>` — plus an
   immediately-following grey descriptive `<p style={{…}}>SUBTITLE</p>`
   if the page has one — becomes:
   ```tsx
   <PageHeader title="TITLE" subtitle="SUBTITLE" />
   ```
   Drop `subtitle` entirely when there is no descriptive line. Import
   `import { PageHeader } from '../components/PageHeader.js';`
   (`./PageHeader.js` from within `components/`).

3. **Section headings.** Every `<h2 style={h2Style}>` or inline
   `<h2 style={{ fontFamily:'var(--mono)', … }}>` → `<h2 className="section-title">`.
   Delete the `h2Style` module const once no longer referenced.

4. **Forms.** `<form className="card" style={{ marginBottom:…,
   display:'flex', flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>` →
   `<form className="card form-grid">`. Inside, each field wrapper
   `<div><label style={fieldStyle}>Label</label><input className="field-input" …/></div>`
   → `<div className="field"><label className="field-label" htmlFor="…">Label</label><input className="field-input" …/></div>`
   (keep the existing `htmlFor`/`id` pairing; add `htmlFor` only if the
   label already had one). `<select className="field-input">` stays.
   Delete the `fieldStyle` const once unreferenced.
   - Fields already wrapped in `<Field>` (ReceitasPage's amount/USD,
     the 2.5.3 validated inputs) are left exactly as they are.

5. **List rows.** `<div style={{ display:'flex',
   justifyContent:'space-between', gap:12, padding:'10px 0',
   borderBottom:'1px solid var(--border)' }}>` → `<div className="list-row">`.
   Any `key={…}` stays. If a row also had `alignItems:'center'`, add it
   back as `className="list-row"` already implies default `stretch`;
   only re-add `style={{ alignItems:'center' }}` if the row visibly
   needs it (checkbox rows — Backup's Fechamento mensal, Dashboard's).

6. **Tables.** `<div style={{ overflowX:'auto' }}>` → `<div className="table-scroll">`.
   `<table style={{ width:'100%', fontSize:12.5, borderCollapse:'collapse' }}>`
   → `<table className="data-table">`. Delete every `<th style={{ padding:'6px 8px' }}>`
   and `<td style={{ padding:'6px 8px' }}>` → bare `<th>` / `<td>`; a
   `<td style={{ padding:'6px 8px', fontFamily:'var(--mono)' }}>` →
   `<td className="mono">`. Delete the header-row
   `<tr style={{ textAlign:'left', color:'var(--text3)' }}>` style →
   bare `<tr>`. Delete the body `<tr style={{ borderTop:'1px solid var(--border)' }}>`
   style → bare `<tr>`.

7. **Data blocks & charts.** `<div style={{ fontSize:13, lineHeight:1.7 }}>`
   wrapping several `<div>` label/value lines → `<div className="data-list">`.
   `<svg … style={{ width:'100%', height:80, … }}>` →
   `<svg … className="chart-svg">` (keep `viewBox` / `preserveAspectRatio`
   attributes; if it also had `marginTop`, drop it — `.page`/parent gap
   covers it, or wrap the block in `.stack`).

8. **Helper / caption text.** `<p style={{ fontSize:12.5,
   color:'var(--text3)', margin… }}>` and `<span style={{ fontSize:12,
   color:'var(--text3)' }}>` → `className="subtle"` (drop the inline
   margins; if a top margin is genuinely needed keep a single
   `style={{ marginTop: 'var(--space-2)' }}`). `color:'var(--text2)'`
   captions → `className="muted"`.

9. **Leftover margins.** Page-level child margins (`marginBottom:20`,
   `marginTop:24`, …) are absorbed by `.page`'s `gap` — delete them.
   Margins *between elements inside one card*: put `stack` / `stack-sm`
   on the card `<div className="card stack-sm">` and delete the child
   margins, OR keep one `style={{ marginTop: 'var(--space-3)' }}` where
   a wrapper would be more disruptive.

10. **Dead consts.** Remove `cardGap`, `h2Style`, `fieldStyle`,
    `cellInput`, and any other now-unreferenced style-object module
    const.

11. **Verify nothing computed was lost.** `width: ${expr}%`, dynamic
    colour, and one-off geometry stay as inline `style`.

After each task: run that file group's test suites + `tsc --noEmit`;
both green before committing.

---

## Task 1: CSS foundation

**Files:**
- Modify: `frontend/src/theme.css`
- Modify: `frontend/src/theme.test.ts`

- [ ] **Step 1: Add the layout block to `theme.css`**

Append at end of file:

```css
/* ---- page layout + shared shapes (2.5.2) ---- */
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

- [ ] **Step 2: Drop the `.page-title` bottom margin**

In `theme.css`, the `.page-title` rule currently is:

```css
.page-title {
  font-family: var(--font-mono);
  font-size: var(--text-xl);
  margin-bottom: var(--space-5);
}
```

Change to:

```css
.page-title {
  font-family: var(--font-mono);
  font-size: var(--text-xl);
}
```

- [ ] **Step 3: Extend the `theme.test.ts` vocabulary assertion**

`theme.test.ts` has a test that asserts a list of class selectors is
present in the stylesheet (search for `.btn` / `.field` / `.page-title`
in an array or a list of `expect(css).toContain(...)` lines). Add the
seven new class names to that same list:

```
.page
.page-header
.form-grid
.list-row
.data-list
.data-table
.chart-svg
```

Match the file's existing style — if it iterates an array of selector
strings, add these strings to the array; if it is separate
`expect(css).toMatch(/\.list-row\s*\{/)` lines, add one per name.

- [ ] **Step 4: Run the theme test + build**

Run: `cd frontend && npx vitest run src/theme.test.ts`
Expected: PASS.
Run: `cd frontend && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theme.css frontend/src/theme.test.ts
git commit -m "Add .page / .page-header / .list-row / .data-table layout classes; drop .page-title margin

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `<PageHeader>` component

**Files:**
- Create: `frontend/src/components/PageHeader.tsx`
- Create: `frontend/src/components/PageHeader.test.tsx`

**Produces:** `PageHeader({ title: string; subtitle?: string; actions?: ReactNode })`
— renders `<header className="page-header">` containing
`<div className="page-header__row"><h1 className="page-title">{title}</h1>{actions && <div className="page-header__actions">{actions}</div>}</div>`
and, when `subtitle` is a non-empty string,
`<p className="page-header__subtitle">{subtitle}</p>`.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/PageHeader.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from './PageHeader.js';

describe('PageHeader', () => {
  it('renders the title as an h1', () => {
    render(<PageHeader title="Receitas" />);
    expect(screen.getByRole('heading', { name: 'Receitas' }).tagName).toBe('H1');
  });

  it('renders the subtitle only when given', () => {
    const { rerender, container } = render(<PageHeader title="X" />);
    expect(container.querySelector('.page-header__subtitle')).toBeNull();
    rerender(<PageHeader title="X" subtitle="uma explicação" />);
    expect(screen.getByText('uma explicação')).toBeInTheDocument();
  });

  it('renders an actions node when given', () => {
    render(<PageHeader title="X" actions={<button>Nova</button>} />);
    expect(screen.getByRole('button', { name: 'Nova' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/PageHeader.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `PageHeader.tsx`**

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

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/PageHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PageHeader.tsx frontend/src/components/PageHeader.test.tsx
git commit -m "Add <PageHeader> — title + optional subtitle + actions slot

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Simple pages — Metas, Projetos, Parcelas, Receitas

**Files:** `frontend/src/pages/{Metas,Projetos,Parcelas,Receitas}Page.tsx`
+ their `.test.tsx` (read-only unless a query breaks).

- [ ] **Step 1: `MetasPage` / `ProjetosPage`** — apply recipe steps 1–2
  only (no inline styles present).
  - `MetasPage`: `<div>` → `<div className="page">`;
    `<h1 className="page-title">Metas</h1>` → `<PageHeader title="Metas" />`.
  - `ProjetosPage`: same with `title="Projetos Especiais"`.
- [ ] **Step 2: `ParcelasPage`** — recipe steps 1–2, 5, 8.
  - `<div>` → `<div className="page">`; h1 → `<PageHeader title="Parcelas" />`.
  - the grouped `<div style={{ display:'flex', justifyContent:'space-between',
    gap:12, padding:'10px 0', borderBottom:… }}>` → `<div className="list-row">`.
  - inner `<span style={{ flex:1 }}>` stays (`flex:1` is layout, keep as
    `style={{ flex: 1 }}` — it is not a repeated shape worth a class);
    `<span style={{ color:'var(--text2)', fontSize:12.5 }}>` →
    `className="subtle"`; `<span style={{ fontFamily:'var(--mono)' }}>` →
    `className="mono"`; the Excluir `<button style={{ background:'none',
    border:'none', … }}>` → keep as-is for now (a bare link-button style
    repeated across pages — out of scope to classify this slice; leave
    the inline style). Actually: add a `.link-btn` class in Task 1? NO —
    not in spec. Keep the button inline styles this slice.
- [ ] **Step 3: `ReceitasPage`** — recipe steps 1–2, 4, 5, 8.
  - `<div>` → `<div className="page">`; h1 → `<PageHeader title="Receitas" />`.
  - `<form … style={{ marginBottom:24, display:'flex', gap:12,
    alignItems:'flex-start' }}>` → `<form className="card form-grid">`
    (note: was `flex-start` post-2.5.3; `.form-grid` uses `flex-end` —
    change to `flex-end` is the consistency fix; the submit button's
    `style={{ marginTop: 20 }}` then no longer aligns — drop it and let
    `align-items:flex-end` handle it).
  - the `<Field>`-wrapped amount / USD inputs stay untouched.
  - the plain `<div><label style={{ display:'block', fontSize:12,
    marginBottom:4 }}>Data</label>` etc. (Data, Descrição, Origem) →
    `<div className="field"><label className="field-label" htmlFor="rec-date">Data</label>`.
  - list rows `<div style={{ display:'flex', justifyContent:'space-between',
    padding:'10px 0', borderBottom:… }}>` → `<div className="list-row">`;
    inner `<span style={{ color:'var(--text2)' }}>` → `className="muted"`,
    `<span style={{ fontFamily:'var(--mono)' }}>` → `className="mono"`,
    the Excluir button inline style stays.
- [ ] **Step 4: Run the suites + tsc**

Run: `cd frontend && npx vitest run src/pages/MetasPage.test.tsx src/pages/ProjetosPage.test.tsx src/pages/ParcelasPage.test.tsx src/pages/ReceitasPage.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/MetasPage.tsx frontend/src/pages/ProjetosPage.tsx frontend/src/pages/ParcelasPage.tsx frontend/src/pages/ReceitasPage.tsx
git commit -m "Migrate Metas/Projetos/Parcelas/Receitas to .page + PageHeader + list-row

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: DashboardPage + LoginPage

**Files:** `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/LoginPage.tsx`
+ tests.

- [ ] **Step 1: `DashboardPage`** — recipe steps 1–2, plus the two
  remaining `style` props.
  - `<div>` → `<div className="page">`. The existing
    `<h1 className="page-title">Dashboard</h1>` → `<PageHeader title="Dashboard" />`.
    Keep it OUTSIDE the `<AsyncBoundary>` exactly as now.
  - the inner `<div className="stack">` that wraps the summary stays.
  - the goal-bar `<div className="dash-goal-fill" style={{ width: \`${g.progressPct}%\` }} />`
    — **computed, keep inline.**
  - any other `style={{}}` in the file (there are ~2): if it is a
    computed SVG value keep it; if it is a static margin, delete it
    (covered by `.stack` / `.page`).
- [ ] **Step 2: `LoginPage`** — recipe step 2 + the margin compensation.
  - `<h1 className="page-title">{isSetupMode ? 'Criar senha' : 'fumarende'}</h1>`
    → keep as a plain `<h1 className="page-title">` (a two-branch dynamic
    title; `<PageHeader title={isSetupMode ? 'Criar senha' : 'fumarende'} />`
    also works — use `<PageHeader>` for consistency).
  - the card wrapper `<div className="card login-card">` →
    `<div className="card login-card stack">` so the header keeps its
    gap to the form now that `.page-title` has no margin.
  - no `.page` wrapper (login is a centred single card).
- [ ] **Step 3: Run the suites + tsc**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.tsx src/pages/LoginPage.test.tsx src/App.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/pages/LoginPage.tsx
git commit -m "Migrate Dashboard + Login to .page / PageHeader; keep login header spacing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: CambioPage + GastosPage

**Files:** `frontend/src/pages/{Cambio,Gastos}Page.tsx` + tests.

- [ ] **Step 1: `CambioPage`** — full recipe.
  - `<div>` → `<div className="page">`.
  - `<h1 className="page-title" style={{ marginBottom: 8 }}>Câmbio</h1>`
    + the following `<p style={{ color:'var(--text3)', fontSize:12.5,
    marginBottom:20 }}>Registre a operação de conversão com o banco. A
    receita em USD entra em Receitas.</p>` →
    `<PageHeader title="Câmbio" subtitle="Registre a operação de conversão com o banco. A receita em USD entra em Receitas." />`.
  - `<form className="card" style={{ marginBottom:20, display:'flex',
    flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>` →
    `<form className="card form-grid">`.
  - every `<div><label htmlFor="cambio-…" style={fieldStyle}>…</label>` →
    `<div className="field"><label className="field-label" htmlFor="cambio-…">…</label>`.
    The 2.5.3 inline `field-error` spans stay.
  - delete `const fieldStyle = …`.
  - the live-preview `<div className="card" style={{ marginBottom:20,
    fontFamily:'var(--mono)', fontSize:13 }}>` → `<div className="card mono data-list">`
    (mono + the stacked lines).
  - the totals `<div className="card" style={{ marginBottom:20, fontSize:13 }}>`
    → `<div className="card data-list">`.
  - list rows `<div style={{ display:'flex', justifyContent:'space-between',
    gap:12, padding:'10px 0', borderBottom:… }}>` → `<div className="list-row">`;
    inner `<span style={{ color:'var(--text2)' }}>` → `className="muted"`,
    `<span style={{ color:'var(--text3)', fontSize:12 }}>` → `className="subtle"`,
    `<span style={{ fontFamily:'var(--mono)' }}>` → `className="mono"`,
    `<span style={{ fontFamily:'var(--mono)', color:'var(--text2)' }}>` →
    `className="mono muted"`. Excluir button inline style stays.
- [ ] **Step 2: `GastosPage`** — full recipe.
  - `<div>` → `<div className="page">`; h1 → `<PageHeader title="Gastos" />`.
  - `<form className="card" style={{ marginBottom:20, display:'flex',
    flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>` →
    `<form className="card form-grid">`; label pairs →
    `<div className="field"><label className="field-label" htmlFor="gasto-…">`;
    the 2.5.3 `field-error` spans on amount / installments stay; delete
    `fieldStyle`.
  - totals `<div className="card" style={{ marginBottom:20, fontSize:13 }}>`
    → `<div className="card data-list">`.
  - the "Categorizar pendentes" `<div style={{ marginBottom:12 }}>` →
    drop the wrapper's style (`.page` gap covers it) →
    `<div>` or hoist the button directly.
  - list card `<div className="card" style={{ marginBottom:32 }}>` →
    `<div className="card">`; rows `<div style={{ display:'flex',
    justifyContent:'space-between', gap:12, padding:'10px 0',
    borderBottom:… }}>` → `<div className="list-row">`; inner
    `<span style={{ color:'var(--text2)' }}>` → `className="muted"`,
    `<span style={{ flex:1 }}>` keep inline, `<span style={{
    color:'var(--text3)', fontSize:12 }}>` → `className="subtle"`,
    `<span style={{ fontStyle:'italic' }}>` keep inline,
    `<span style={{ fontFamily:'var(--mono)' }}>` → `className="mono"`.
    Excluir button inline stays.
- [ ] **Step 3: Run the suites + tsc**

Run: `cd frontend && npx vitest run src/pages/CambioPage.test.tsx src/pages/GastosPage.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/CambioPage.tsx frontend/src/pages/GastosPage.tsx
git commit -m "Migrate Câmbio + Gastos to .page / PageHeader / form-grid / list-row / data-list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: ReservaPage + HistoricoDolarPage

**Files:** `frontend/src/pages/{Reserva,HistoricoDolar}Page.tsx` + tests.

- [ ] **Step 1: `ReservaPage`** — full recipe.
  - `<div>` → `<div className="page">`; h1 → `<PageHeader title="Reserva de emergência" />`.
  - status card `<div className="card" style={{ marginBottom:20, fontSize:13 }}>`
    → `<div className="card data-list">` (keep the `{r.data && (…)}` guard).
  - the three `<form className="card" style={{ marginBottom:…, display:'flex',
    flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>` →
    `<form className="card form-grid">`; label pairs →
    `<div className="field"><label className="field-label" htmlFor="dep-…/wd-…/meta-…">`;
    the 2.5.3 `field-error` spans on `dep-amount` / `wd-amount` stay;
    delete `fieldStyle`.
  - the withdraw-exceeds warning `<p style={{ width:'100%', margin:0,
    fontSize:12.5, color:'var(--text3)' }}>` → `<p className="subtle" style={{ width: '100%' }}>`
    (the `width:100%` forces its own row in the flex form — keep that
    one declaration).
  - Meta Mensal form: `<h2 style={{ fontFamily:'var(--mono)', fontSize:15,
    marginBottom:10 }}>Meta mensal</h2>` → `<h2 className="section-title">Meta mensal</h2>`;
    the inner `<div style={{ display:'flex', flexWrap:'wrap', gap:12,
    alignItems:'flex-end' }}>` → `<div className="form-grid">`; the
    `<div style={{ marginBottom:10 }}>` status lines → wrap in
    `<div className="data-list">` or `className="stack-sm"`.
  - ledger rows `<div style={{ display:'flex', justifyContent:'space-between',
    gap:12, padding:'10px 0', borderBottom:… }}>` → `<div className="list-row">`;
    inner `<span style={{ color:'var(--text2)' }}>` → `className="muted"`,
    `<span style={{ flex:1 }}>` keep, `<span style={{
    fontFamily:'var(--mono)' }}>` → `className="mono"`. Excluir button
    inline stays.
- [ ] **Step 2: `HistoricoDolarPage`** — full recipe (highest inline count).
  - `<div>` → `<div className="page">`.
  - `<h1 className="page-title" style={{ marginBottom:8 }}>Histórico Dólar</h1>`
    + `<p style={{ color:'var(--text3)', fontSize:12.5, marginBottom:20 }}>Como a cotação afeta seu salário em reais.</p>`
    → `<PageHeader title="Histórico Dólar" subtitle="Como a cotação afeta seu salário em reais." />`.
  - `<form className="card" style={{ marginBottom:20, display:'flex',
    flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>` →
    `<form className="card form-grid">`; label pairs →
    `<div className="field"><label className="field-label" htmlFor="dol-…">`;
    the 2.5.3 `field-error` spans on `dol-rate` / `dol-salary` stay;
    delete `fieldStyle`.
  - the chart card `<div className="card" style={{ marginBottom:20 }}>`
    → `<div className="card">`; `<svg viewBox="0 0 320 80"
    preserveAspectRatio="none" style={{ width:'100%', height:80 }}>` →
    `<svg viewBox="0 0 320 80" preserveAspectRatio="none" className="chart-svg">`;
    the legend `<div style={{ display:'flex', justifyContent:'space-between',
    fontSize:11, color:'var(--text3)' }}>` → `<div className="row" style={{ justifyContent: 'space-between' }}>`
    with the two `<span className="subtle">`… actually simpler: keep a
    small `<div className="chart-legend">`? NOT in spec — instead
    `<div className="subtle" style={{ display: 'flex', justifyContent: 'space-between' }}>`.
  - table card `<div className="card" style={{ overflowX:'auto' }}>` →
    `<div className="card table-scroll">`; `<table style={{ width:'100%',
    fontSize:12.5, borderCollapse:'collapse' }}>` → `<table className="data-table">`;
    delete all `<th style={{ padding:'6px 8px' }}>` → `<th>`; delete
    `<tr style={{ textAlign:'left', color:'var(--text3)' }}>` → `<tr>`;
    `<tr style={{ borderTop:'1px solid var(--border)' }}>` → `<tr>`;
    `<td style={{ padding:'6px 8px' }}>` → `<td>`;
    `<td style={{ padding:'6px 8px', fontFamily:'var(--mono)' }}>` →
    `<td className="mono">`;
    `<td style={{ padding:'6px 8px', fontFamily:'var(--mono)', color:'var(--text2)' }}>`
    → `<td className="mono muted">`. The Excluir button inside the last
    `<td>` keeps its inline style.
  - the empty `<p style={{ color:'var(--text3)' }}>` is already an
    `<EmptyState>` from 2.5.3 — untouched.
- [ ] **Step 3: Run the suites + tsc**

Run: `cd frontend && npx vitest run src/pages/ReservaPage.test.tsx src/pages/HistoricoDolarPage.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/ReservaPage.tsx frontend/src/pages/HistoricoDolarPage.tsx
git commit -m "Migrate Reserva + Histórico Dólar to .page / PageHeader / form-grid / data-table / chart-svg

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: AnalisePage + BackupDadosPage

**Files:** `frontend/src/pages/{Analise,BackupDados}Page.tsx` + tests.

- [ ] **Step 1: `AnalisePage`** — full recipe.
  - `<div>` → `<div className="page">`; `<h1 style={{ fontFamily:'var(--mono)',
    fontSize:20, marginBottom:20 }}>Análise</h1>` → `<PageHeader title="Análise" />`.
    (It is currently `<h1 className="page-title">` from 2.5.3 — if so,
    just swap to `<PageHeader>`.)
  - delete `const cardGap = { marginBottom: 24 } as const;` and
    `const h2Style = …`.
  - each `<div className="card" style={cardGap}>` → `<div className="card">`.
  - each `<h2 style={h2Style}>` → `<h2 className="section-title">`.
  - `<div style={{ fontSize:13, lineHeight:1.7 }}>` blocks →
    `<div className="data-list">`.
  - the projeção note `<p style={{ color:'var(--text3)', fontSize:13 }}>`
    → `<p className="subtle">`.
  - `<svg viewBox="0 0 320 80" preserveAspectRatio="none" style={{
    width:'100%', height:80, marginTop:10 }}>` →
    `<svg viewBox="0 0 320 80" preserveAspectRatio="none" className="chart-svg">`
    (the `marginTop:10` is covered by `.data-list` gap / card padding —
    drop it, or wrap the svg block in `.stack-sm`).
  - the chart legend `<div style={{ display:'flex',
    justifyContent:'space-between', fontSize:11, color:'var(--text3)' }}>`
    → `<div className="subtle" style={{ display: 'flex', justifyContent: 'space-between' }}>`.
  - Cenários rows `<div style={{ display:'flex', alignItems:'center',
    gap:12, padding:'8px 0', borderBottom:… }}>` → `<div className="list-row" style={{ alignItems: 'center' }}>`.
  - inner `<div style={{ flex:1, fontSize:12.5 }}>` keep `flex:1`, drop
    fontSize (list-row is already `--text-sm`): `<div style={{ flex: 1 }}>`;
    `<span style={{ color:'var(--text3)' }}>` → `className="subtle"`;
    `<span style={{ width:40, fontSize:12.5, color:'var(--text2)' }}>` →
    `<span className="muted" style={{ width: 40 }}>`.
  - `<div style={{ marginTop:10, fontSize:13 }}>Corte total: …</div>` →
    `<div className="subtle" style={{ marginTop: 'var(--space-2)' }}>` or
    wrap the catalog list + total in `.stack-sm`.
  - `<ConsultorIA />` and `<AiUsageSection />` stay (migrated in Task 8).
- [ ] **Step 2: `BackupDadosPage`** — full recipe.
  - `<div>` → `<div className="page">`; `<h1 className="page-title">Backup &amp; Dados</h1>`
    → `<PageHeader title="Backup & Dados" />` (plain ampersand in the JS
    string — no `&amp;` needed inside `{}`).
  - delete `const cardGap` and `const h2Style`.
  - `<div className="card" style={cardGap}>` → `<div className="card">`
    (all five).
  - `<h2 style={h2Style}>` → `<h2 className="section-title">` (all five).
  - Diagnóstico `<div style={{ fontSize:12.5, lineHeight:1.7 }}>` →
    `<div className="data-list">`.
  - Exportar `<a href={api.EXPORT_URL} download className="button-primary"
    style={{ display:'inline-block', textDecoration:'none' }}>` — keep
    `style={{ display: 'inline-block', textDecoration: 'none' }}` (an
    `<a>` styled as a button; `.btn` sets `inline-flex` which would also
    work — swap `className="button-primary"` → `className="btn btn-primary"`
    and drop the inline style). Do the swap: `<a … className="btn btn-primary">`.
  - Importar: `<p style={{ fontSize:12.5, color:'var(--text3)', marginBottom:8 }}>`
    → `<p className="subtle">`; `<input … style={{ display:'block',
    marginBottom:8 }}>` → keep `style={{ display: 'block' }}` (file input
    layout) — or wrap the section in `.stack-sm` and drop it; prefer
    `.stack-sm` on the card. `<label style={{ display:'block',
    fontSize:12.5, marginBottom:8 }}>` → `<label className="row-sm">`
    (checkbox + text inline) or `className="subtle"` with
    `style={{ display: 'block' }}`.
  - Zona de perigo: `<p style={{ fontSize:12.5, color:'var(--text3)',
    marginBottom:8 }}>` → `<p className="subtle">`; `<input type="text"
    … className="field-input" … style={{ display:'block', marginBottom:10 }}>`
    → keep as `className="field-input" style={{ display: 'block' }}` OR
    wrap card in `.stack-sm`; `<div style={{ display:'flex', gap:12 }}>`
    → `<div className="row">`.
  - Fechamento mensal rows `<div style={{ display:'flex',
    alignItems:'center', gap:10, padding:'6px 0', borderBottom:… }}>` →
    `<div className="list-row" style={{ alignItems: 'center' }}>`;
    `<span style={{ fontFamily:'var(--mono)', fontSize:12.5 }}>` →
    `className="mono"`; `<span style={{ fontSize:11, color:'var(--text3)' }}>`
    → `className="subtle"`.
  - the `<EmptyState>` from 2.5.3 stays.
- [ ] **Step 3: Run the suites + tsc**

Run: `cd frontend && npx vitest run src/pages/AnalisePage.test.tsx src/pages/BackupDadosPage.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/AnalisePage.tsx frontend/src/pages/BackupDadosPage.tsx
git commit -m "Migrate Análise + Backup to .page / PageHeader / section-title / data-list / data-table

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Components A — ConsultorIA, AiUsageSection, BarBreakdown

**Files:** `frontend/src/components/{ConsultorIA,AiUsageSection,BarBreakdown}.tsx`
+ tests.

These render *into* a page — **no `.page` wrapper, no `<PageHeader>`**.
Apply recipe steps 3, 6, 7, 8, 10 only.

- [ ] **Step 1: `ConsultorIA`**
  - delete `const h2Style = …`; `<h2 style={h2Style}>Consultor IA</h2>`
    → `<h2 className="section-title">Consultor IA</h2>`.
  - `{loadError && <p className="error-text" style={{ marginBottom:10 }}>…}`
    → drop the inline margin: `<p className="error-text">`.
  - `<p style={{ fontSize:12.5, color:'var(--text3)', fontStyle:'italic',
    marginBottom:10 }}>` → `<p className="subtle" style={{ fontStyle: 'italic' }}>`.
  - `<div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>` (preset
    buttons) → `<div className="row-sm">`.
  - `<label style={{ display:'block', marginTop:8, fontSize:12,
    color:'var(--text3)' }}>` → `<label className="subtle" style={{ display: 'block', marginTop: 'var(--space-2)' }}>`.
  - `<p style={{ fontSize:12.5, color:'var(--red, var(--text))',
    marginTop:10 }}>{warn}</p>` → `<p className="error-text" style={{ marginTop: 'var(--space-2)' }}>`.
  - `<div style={{ marginTop:14, fontSize:13 }}>` (latest response) →
    `<div style={{ marginTop: 'var(--space-4)' }}>`.
  - history `<div style={{ marginTop:16 }}>` → `style={{ marginTop: 'var(--space-4)' }}`;
    the toggle `<button style={{ background:'none', border:'none',
    padding:0, fontSize:12.5, color:'var(--text2)', cursor:'pointer' }}>`
    → keep inline (link-button, out of scope); `<div style={{ marginTop:10 }}>`
    → `style={{ marginTop: 'var(--space-3)' }}`; each history entry
    `<div style={{ borderTop:'1px solid var(--border)', padding:'10px 0',
    fontSize:12.5 }}>` → `<div className="list-row" style={{ display: 'block' }}>`
    (border-top vs bottom differ — simplest: keep a small
    `<div style={{ borderTop: '1px solid var(--border)', padding: 'var(--space-3) 0' }}>`);
    `<div style={{ color:'var(--text3)', marginBottom:4 }}>` →
    `<div className="subtle">`.
- [ ] **Step 2: `AiUsageSection`**
  - delete `const h2Style`; `<h2 style={h2Style}>Uso da IA</h2>` →
    `<h2 className="section-title">Uso da IA</h2>`.
  - its month-to-date line, by-endpoint table, and recent-calls log:
    apply table recipe (step 6) to the `<table>` → `className="data-table"`,
    drop th/td padding; helper text → `.subtle`; margins → drop or
    `var(--space-*)`.
- [ ] **Step 3: `BarBreakdown`**
  - it has ~6 inline styles (bar track, fill `width: ${pct}%`, label
    row). The fill `width` is **computed — keep inline.** The static
    track / label / empty-text styles → classes: reuse `.dash-goal-track`
    / `.dash-goal-fill` if identical, else add `.bar-row` / `.bar-track`
    / `.bar-fill` to `theme.css`? NOT in spec. Instead: keep
    `BarBreakdown`'s static styles inline for this slice IF they do not
    match an existing class — `BarBreakdown` is a self-contained
    primitive and its 6 styles are local. **Decision: migrate only its
    text/margin styles to `.subtle` / `.muted` / scale vars; leave the
    track/fill geometry inline (fill width is computed anyway).** Note
    this partial migration in the commit message.
- [ ] **Step 4: Run the suites + tsc**

Run: `cd frontend && npx vitest run src/components/ConsultorIA.test.tsx src/components/AiUsageSection.test.tsx src/components/BarBreakdown.test.tsx src/pages/AnalisePage.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ConsultorIA.tsx frontend/src/components/AiUsageSection.tsx frontend/src/components/BarBreakdown.tsx
git commit -m "Migrate ConsultorIA / AiUsageSection / BarBreakdown to section-title / data-table / subtle

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Components B — TargetCard, TargetSection, FixedExpensesSection, CategoryRulesSection, StatementImportSection

**Files:** `frontend/src/components/{TargetCard,TargetSection,FixedExpensesSection,CategoryRulesSection,StatementImportSection}.tsx`
+ tests. No `.page` / `<PageHeader>` — recipe steps 3, 4, 5, 6, 7, 8, 10.

- [ ] **Step 1: `TargetSection`**
  - `<h2 style={{ fontFamily:'var(--mono)', fontSize:15, marginBottom:12 }}>{heading}</h2>`
    → `<h2 className="section-title">{heading}</h2>`.
  - `<form className="card" style={{ marginBottom:20, display:'flex',
    flexWrap:'wrap', gap:12, alignItems:'flex-end' }}>` →
    `<form className="card form-grid">`; the field `<div><label style={fieldStyle}>`
    pairs → `<div className="field"><label className="field-label" htmlFor="tgt-…">`;
    delete `fieldStyle`.
  - the `<EmptyState>` from 2.5.3 stays.
- [ ] **Step 2: `TargetCard`** (~11 styles)
  - card container, name/value rows, progress track, the `width: ${pct}%`
    fill (**computed — keep inline**), the edit-form field pairs.
  - static rows → `.list-row` / `.row` / `.data-list`; labels →
    `.field-label`; helper text → `.subtle` / `.muted`; the progress
    track → reuse `.dash-goal-track` + `.dash-goal-fill` (same shape as
    Dashboard) — apply those class names, keep the `style={{ width }}` on
    the fill.
- [ ] **Step 3: `FixedExpensesSection`** (~11 styles)
  - `<h2 style={{ fontFamily:'var(--mono)', fontSize:16, marginBottom:12 }}>Gastos fixos</h2>`
    → `<h2 className="section-title">`.
  - form → `.form-grid`; field pairs → `.field` / `.field-label`;
    delete `fieldStyle` if present.
  - list rows → `.list-row`; helper / error text → `.subtle` /
    `.error-text` (drop inline margins).
  - `{error && <p className="error-text" style={{ marginTop:10 }}>…}` →
    `<p className="error-text">`.
- [ ] **Step 4: `CategoryRulesSection`** (~10 styles)
  - `<h2 style={{ fontFamily:'var(--mono)', fontSize:16, marginBottom:12 }}>`
    → `<h2 className="section-title">`.
  - form → `.form-grid` / `.field` / `.field-label`; list rows →
    `.list-row`; `{error && <p className="error-text" style={{ marginTop:10 }}>}`
    → `<p className="error-text">`; the `<EmptyState>` from 2.5.3 stays.
- [ ] **Step 5: `StatementImportSection`** (~21 styles — highest)
  - delete `const fieldStyle` and `const cellInput`.
  - `<h2 style={{ fontFamily:'var(--mono)', fontSize:16, marginBottom:12 }}>Importar extrato (PDF)</h2>`
    → `<h2 className="section-title">`.
  - `<div style={{ marginTop:24 }}>` outer → `<div className="stack">` or
    drop (it renders after other Gastos sections; a single
    `style={{ marginTop: 'var(--space-5)' }}` is fine).
  - `<label htmlFor="statement-file" style={fieldStyle}>` →
    `<label className="field-label" htmlFor="statement-file">`.
  - the 2.5.3 reading-phase block (`.progress-indeterminate`, elapsed
    text, Cancelar) — its `style={{ marginTop:10 }}` / `marginTop:6` /
    `marginLeft:8` become `var(--space-*)`; the `.subtle` class is
    already used there.
  - `{error && <p className="error-text" style={{ marginTop:10 }}>}` →
    `<p className="error-text">`; `{result && <p style={{ marginTop:10,
    fontSize:13, color:'var(--text2)' }}>}` → `<p className="muted">`.
  - the empty-review block `<div style={{ marginTop:14 }}>` + its
    `<p style={{ fontSize:13, color:'var(--text2)' }}>` /
    `<p style={{ fontSize:12.5, color:'var(--text3)', marginTop:6 }}>`
    → `<div className="stack-sm">` + `<p className="muted">` /
    `<p className="subtle">`.
  - the review table: `<div style={{ marginTop:14 }}>` → `<div className="stack-sm">`;
    `<p style={{ fontSize:12.5, color:'var(--text3)', marginBottom:10 }}>`
    (warnings) → `<p className="subtle">`; `<div style={{ overflowX:'auto' }}>`
    → `<div className="table-scroll">`; `<table style={{ width:'100%',
    fontSize:12.5, borderCollapse:'collapse' }}>` → `<table className="data-table">`;
    `<tr style={{ textAlign:'left', color:'var(--text3)' }}>` → `<tr>`;
    `<tr style={{ borderTop:'1px solid var(--border)' }}>` → `<tr>`; the
    per-cell `<input className="field-input" style={cellInput}>` /
    `style={{ ...cellInput, width:110 }}` → `className="field-input"
    style={{ width: '100%' }}` (or `style={{ width: 110 }}` for the
    amount cell — `cellInput` was `{ width:'100%', boxSizing:'border-box' }`;
    `box-sizing` is global in `theme.css` `*`, so just `width`);
    `<td style={{ color:'var(--text3)', whiteSpace:'nowrap' }}>` →
    `<td className="subtle" style={{ whiteSpace: 'nowrap' }}>`.
  - `<button className="button-primary" style={{ marginTop:12 }}>` →
    `<button className="button-primary" style={{ marginTop: 'var(--space-3)' }}>`
    (or wrap the block in `.stack-sm` and drop it).
- [ ] **Step 6: Run the suites + tsc + full frontend suite**

Run: `cd frontend && npx vitest run src/components/TargetCard.test.tsx src/components/TargetSection.test.tsx src/components/FixedExpensesSection.test.tsx src/components/CategoryRulesSection.test.tsx src/components/StatementImportSection.test.tsx src/pages/GastosPage.test.tsx src/pages/MetasPage.test.tsx src/pages/ProjetosPage.test.tsx`
Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/TargetCard.tsx frontend/src/components/TargetSection.tsx frontend/src/components/FixedExpensesSection.tsx frontend/src/components/CategoryRulesSection.tsx frontend/src/components/StatementImportSection.tsx
git commit -m "Migrate Target/FixedExpenses/CategoryRules/StatementImport sections to the class vocabulary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Sweep, grep-verify, build, smoke, docs

**Files:** `docs/qa-checklist.md`, `README.md`.

- [ ] **Step 1: Grep for leftover inline styles**

Run: `cd frontend && grep -rn "style={{" src/ | grep -v NavShell`
Expected: only computed / justified lines remain — enumerate them:
goal-bar `width: \`${…}%\`` (`DashboardPage`, `TargetCard`,
`BarBreakdown`, Análise cut sliders' `width: 40`), `flex: 1` spans,
`whiteSpace: 'nowrap'`, `width: '100%'` on the Reserva warning and the
import amount cell, `fontStyle: 'italic'`, the link-button `background:
'none'` Excluir/toggle buttons, and any `marginTop: 'var(--space-*)'`
kept deliberately. If anything else appears, migrate it or justify it in
the commit message.

- [ ] **Step 2: Full sweeps**

Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm run build` — all green, exit 0.
Run: `cd server && npm test` — unchanged green.
Run: `bash scripts/qa-e2e.sh` — unchanged, `0 failed`.

- [ ] **Step 3: Restart live server + browser smoke**

```bash
cd frontend && npm run build
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1.5
curl -s -o /dev/null -w 'home: %{http_code}\n' http://localhost:4173/
```

Manual: open each page — content and spacing match the pre-slice look
(±1–2px on the noted consistency fixes: section headings 15→16px, card
gaps → 24px, list-row padding 10→12px); the Câmbio and Histórico Dólar
subtitles render under the title; light and dark both intact; the PDF
import review table and the AI-usage table render with the shared
`.data-table` styling.

- [ ] **Step 4: Docs**

`docs/qa-checklist.md` — bump the frontend test count (159 after
`PageHeader.test`); add a `## Styling convention (Phase 2.5.2)` section:

```markdown
- [x] `<PageHeader>` — `title` renders an `<h1>`, `subtitle` renders
      only when passed, an `actions` node renders when passed (3 unit
      tests).
- [x] `theme.css` gains `.page`, `.page-header*`, `.form-grid`,
      `.list-row`, `.data-list`, `.data-table`, `.chart-svg`; the
      vocabulary parse test asserts all seven are present.
- [x] All 11 pages wrap their body in `.page` and their heading in
      `<PageHeader>`; every page/component test passes unchanged
      (assertions are on text/role/label, not style).
- [x] `grep -rn "style={{" frontend/src` returns only computed values
      (goal-bar/slider width, `flex:1`, `whiteSpace:nowrap`,
      link-button reset) — no static styling remains outside `theme.css`
      and `NavShell`.
- [ ] Browser: every page's content and spacing matches the pre-slice
      look within the noted consistency shifts (headings 15→16px, card
      gaps →24px, list-row padding 10→12px); Câmbio / Histórico Dólar
      subtitles render; light + dark intact; the import + AI-usage
      tables share the `.data-table` look.
```

`README.md` — under Phase 2.5, mark 2.5.2 done; 2.5.4 (a11y audit) is
next.

- [ ] **Step 5: Commit**

```bash
git add docs/qa-checklist.md README.md
git commit -m "Styling convention: docs + checklist"
```

---

## Self-Review

**Spec coverage**

| Spec item | Task |
|---|---|
| `.page` wrapper class | 1 |
| `.page-header*` classes | 1 |
| `.form-grid` | 1 |
| `.list-row` (+ `:last-child`) | 1 |
| `.data-list` | 1 |
| `.data-table` (+ th/td/tr rules) | 1 |
| `.chart-svg` | 1 |
| `.page-title` loses `margin-bottom` | 1 |
| `theme.test.ts` vocabulary += 7 names | 1 |
| `<PageHeader title subtitle? actions?>` component + test | 2 |
| 11 pages → `.page` + `<PageHeader>` | 3 (Metas/Projetos/Parcelas/Receitas), 4 (Dashboard), 5 (Câmbio/Gastos), 6 (Reserva/HistDólar), 7 (Análise/Backup) |
| Câmbio + Histórico Dólar subtitles via `<PageHeader subtitle>` | 5, 6 |
| `h2Style` literals → `.section-title`, const deleted | 5, 6, 7, 8, 9 |
| form `style` → `.form-grid`; label pairs → `.field`/`.field-label`; `fieldStyle` deleted | 3, 5, 6, 7, 9 |
| list rows → `.list-row` | 3, 5, 6, 7 (Cenários/Fechamento), 9 |
| tables → `.table-scroll` + `.data-table`, th/td padding dropped | 6 (HistDólar), 7 (Backup), 8 (AiUsage), 9 (StatementImport) |
| info blocks → `.data-list`; charts → `.chart-svg` | 5, 6, 7 |
| helper text → `.subtle` / `.muted` | every migration task |
| LoginPage: `.stack` on card to keep header spacing | 4 |
| computed styles kept inline (goal-bar width, geometry) | 4, 8, 9, 10 (grep) |
| consistency fixes (heading 16px, gaps 24px, row padding 12px) | 1 (CSS) + applied 3–9 |
| 8 shared components migrated | 8 (3), 9 (5) |
| `NavShell` untouched | Global Constraints |
| no server / e2e / token change | Global Constraints + 10 |
| docs + README | 10 |
| grep-verify only computed styles remain | 10 |

**Placeholder scan:** no `TODO`/`TBD`. Tasks 3–9 do not re-print each
file's full JSX — they enumerate the exact per-file element→class
substitutions on top of the shared "Migration Recipe" section, which
carries the transform code once (DRY, per the skill's "repeat the code"
applying to *logic an out-of-order reader needs*, not a 20×-identical
mechanical swap). Tasks 1 and 2 give complete code. `BarBreakdown`
(Task 8 Step 3) and `ConsultorIA` history entries (Task 8 Step 1) call
out explicitly where the migration is deliberately partial and why.

**Type consistency:**
- `PageHeader` props `{ title: string; subtitle?: string; actions?:
  ReactNode }` — Task 2 definition; every call site in Tasks 3–7 passes
  `title` (always) and `subtitle` (Câmbio, Histórico Dólar only), never
  `actions`. Matches.
- No other new exported symbol. All class names introduced in Task 1
  are referenced verbatim (`page`, `page-header`, `page-header__row`,
  `page-header__subtitle`, `page-header__actions`, `form-grid`,
  `list-row`, `data-list`, `data-table`, `chart-svg`) by `<PageHeader>`
  (Task 2) and the migration tasks; `theme.test.ts` (Task 1 Step 3)
  asserts the seven top-level ones.
- Reused existing classes (`.section-title`, `.field`, `.field-label`,
  `.field-input`, `.muted`, `.subtle`, `.mono`, `.stack`, `.stack-sm`,
  `.row`, `.row-sm`, `.table-scroll`, `.card`, `.btn`, `.btn-primary`,
  `.button-primary`, `.error-text`, `.dash-goal-track`,
  `.dash-goal-fill`) all exist in `theme.css` as of 2.5.1 — no new
  definitions needed for them.
