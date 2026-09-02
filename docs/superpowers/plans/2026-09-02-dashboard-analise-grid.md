# Dashboard & Análise Grid Implementation Plan (Phase 2.5.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable `.grid` / `.grid__full` CSS utility and have
Dashboard and Análise lay their existing cards into it — one column
narrow, two+ wide, source order preserved.

**Architecture:** `.grid` is `display: grid` with
`grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))`, so it is
intrinsically responsive with no media query. Dashboard swaps its
`.stack` wrapper for `.grid` and marks three cards `grid__full`; Análise
wraps its four in-boundary cards in a `.grid`. No new component, no
content change.

**Tech Stack:** React 18, Vite 6, Vitest (+ `@testing-library/react`),
plain CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-dashboard-analise-grid-design.md`

## Global Constraints

- **Frontend only.** No new dependency, no new component, no server /
  e2e change, no content-width change (`.main > *` stays 1080px), no
  per-page media queries.
- **No content redesign.** The 4 Dashboard figures stay in one
  `.card row`; charts, wording, card order untouched.
- **`ConsultorIA` / `AiUsageSection`** on Análise are untouched —
  full-width, stacked below the grid, outside the `AsyncBoundary`.
- Existing Dashboard / Análise tests assert on headings, text, roles,
  and testids — the grid wrapper changes none of them; they must pass
  unchanged.
- Frontend tests run from `frontend/`. Typecheck: `./node_modules/.bin/tsc
  -p tsconfig.json --noEmit` from `frontend/`.
- Branch `dashboard-analise-grid` off `main`; the finishing skill
  merges it. One commit per task.

---

## Task 1: `.grid` utility + vocabulary test

**Files:**
- Modify: `frontend/src/theme.css`
- Modify: `frontend/src/theme.test.ts`

- [ ] **Step 1: Append the grid classes to `theme.css`**

In the `/* ---- page layout + shared shapes (2.5.2) ---- */` block (or
at end of file), add:

```css
.grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  align-items: start;
}
.grid__full {
  grid-column: 1 / -1;
}
```

- [ ] **Step 2: Add both names to the vocabulary test**

In `theme.test.ts`, the "defines the class vocabulary" test iterates an
array of selector strings. Add `'.grid'` and `'.grid__full'`.

- [ ] **Step 3: Run the theme test + build**

Run: `cd frontend && npx vitest run src/theme.test.ts`
Expected: PASS.
Run: `cd frontend && npm run build` — exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/theme.css frontend/src/theme.test.ts
git commit -m "Add responsive .grid / .grid__full layout utility

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Dashboard + Análise into the grid

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/AnalisePage.tsx`
- Modify: `frontend/src/pages/DashboardPage.test.tsx`
- Modify: `frontend/src/pages/AnalisePage.test.tsx`

- [ ] **Step 1: `DashboardPage.tsx`**

Inside the `AsyncBoundary`, make exactly these four changes — nothing
else moves:

1. `<div className="stack">` → `<div className="grid">`
2. `<p className="subtle">{summary.month}</p>` →
   `<p className="subtle grid__full">{summary.month}</p>`
3. the stat card `<div className="card row">` →
   `<div className="card row grid__full">`
4. the Alertas card `<div className="card">` (the one inside
   `{summary.alerts.length > 0 && (…)}`) → `<div className="card grid__full">`

Leave the category-bar card, the Evolução card, Últimos gastos, Metas
em andamento, Parcelas ativas, and Fechamento do mês exactly as they
are — they tile two-up in source order.

- [ ] **Step 2: `AnalisePage.tsx`**

Inside the `AsyncBoundary`, wrap the four cards — Resumo
(`<div className="card"><h2 …>Resumo…`), Gastos por categoria, Projeção
12 meses, Cenários — in a single `<div className="grid">…</div>`. The
opening `<div className="grid">` goes right after the
`<AsyncBoundary …>` line; the closing `</div>` goes right before
`</AsyncBoundary>`. Do **not** move `<ConsultorIA />` or
`<AiUsageSection />` — they stay after `</AsyncBoundary>`.

- [ ] **Step 3: `DashboardPage.test.tsx` — add a grid assertion**

The existing tests use a `renderPage()` helper returning the RTL result
(so `container` is available via `renderPage()`), or call `render(…)`
directly. Add one test in the `describe('DashboardPage')` block:

```tsx
it('lays the cards out in a responsive grid', async () => {
  const { container } = renderPage();
  await screen.findByText('R$ 5.000,00'); // summary loaded
  expect(container.querySelector('.grid')).not.toBeNull();
  expect(container.querySelector('.card.row.grid__full')).not.toBeNull();
});
```

(If `renderPage()` does not return the render result, change it to
`return render(<MonthProvider><DashboardPage /></MonthProvider>);` — it
almost certainly already does.)

- [ ] **Step 4: `AnalisePage.test.tsx` — add a grid assertion**

```tsx
it('lays the analysis cards out in a grid', async () => {
  const { container } = renderPage();
  await screen.findByRole('heading', { name: 'Resumo' });
  const grid = container.querySelector('.grid');
  expect(grid).not.toBeNull();
  expect(grid?.querySelector('h2')?.textContent).toBe('Resumo');
});
```

- [ ] **Step 5: Run both suites + tsc + build**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.tsx src/pages/AnalisePage.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm run build`
Expected: all PASS, no type errors, build exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/pages/AnalisePage.tsx frontend/src/pages/DashboardPage.test.tsx frontend/src/pages/AnalisePage.test.tsx
git commit -m "Dashboard + Análise: flow cards into the responsive .grid

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Sweep, build, smoke, docs

**Files:** `docs/qa-checklist.md`, `README.md`.

- [ ] **Step 1: Full sweeps**

Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm run build` — green, exit 0.
Run: `cd server && npm test` — unchanged green.
Run: `bash scripts/qa-e2e.sh` — unchanged, `0 failed`.

- [ ] **Step 2: Restart live server + browser smoke**

```bash
cd frontend && npm run build
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1.5
curl -s -o /dev/null -w 'home: %{http_code}\n' http://localhost:4173/
```

Manual: desktop → Dashboard shows the month label + stat strip
full-width then the rest of the cards two-up; Análise shows Resumo +
category chart on row one, Projeção + Cenários on row two, ConsultorIA
+ AiUsage full-width below. Narrow (~500px) → both collapse to one
column, same spacing as before. Light + dark unchanged.

- [ ] **Step 3: Docs**

`docs/qa-checklist.md` — bump the frontend test count (169); add a
`## Dashboard / Análise grid (Phase 2.5.5)` section:

```markdown
- [x] `.grid` / `.grid__full` present (vocab parse test) —
      `repeat(auto-fit, minmax(320px, 1fr))`, no media query.
- [x] Dashboard wraps its cards in `.grid`; the month label, the stat
      strip (`.card.row`), and the Alertas callout carry `grid__full`
      (unit test asserts `.grid` and `.card.row.grid__full` render).
- [x] Análise wraps its four in-boundary cards (Resumo / categoria /
      Projeção / Cenários) in `.grid`; ConsultorIA + AiUsage stay
      full-width below (unit test asserts the `.grid` wraps "Resumo").
- [ ] Browser: desktop tiles the cards two-up (stat strip + Alertas
      full-width); ~500px collapses to one column identical to before;
      light + dark unchanged.
```

`README.md` — under Phase 2.5, mark 2.5.5 done; note Phase 2.5 is
complete and Phase 3 (Open Finance, unscoped) is next.

- [ ] **Step 4: Commit**

```bash
git add docs/qa-checklist.md README.md
git commit -m "Dashboard/Análise grid: docs + checklist"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| 1. `.grid` + `.grid__full` CSS | 1 |
| `theme.test.ts` vocab += 2 | 1 |
| 2. Dashboard `.stack` → `.grid` + 3× `grid__full` | 2 |
| 3. Análise wrap 4 cards in `.grid`; ConsultorIA/AiUsage untouched | 2 |
| 4. charts unchanged (denser in narrow columns) | n/a — no code |
| test assertions on both pages | 2 |
| verification / docs | 3 |

**Placeholder scan:** no `TODO`/`TBD`. Every change is a named
class-string edit; the two new tests are given in full. Task 2 Step 1
enumerates the exact four Dashboard edits and no others.

**Type consistency:** no new symbol, no signature change. `.grid` /
`.grid__full` (Task 1) are referenced verbatim by Task 2's JSX and
Task 2's test selectors (`.card.row.grid__full`, `.grid`).

**Risk note:** `auto-fit` + `minmax(320px, 1fr)` means a viewport whose
content column is between 320px and ~680px shows one column — identical
to today. The only behavioural change is at ≥ ~680px content width,
where cards tile. No test depends on single-column layout.
