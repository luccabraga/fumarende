# Dashboard & Análise Grid — Design (Phase 2.5.5)

**Status:** approved 2026-09-02. Frontend only. No new dependency, no
new component, no content redesign — a responsive grid utility and two
pages wrapping their existing cards in it.

## Problem

The audit flagged "no page hierarchy on Dashboard / Análise". Both
pages are a single vertical `.stack` of full-width cards, capped at
`max-width: 1080px` and centred, so on a desktop they render as a tall
narrow column with a wide empty gutter on each side. Nothing tiles;
scanning the dashboard means scrolling past eight stacked cards.

## Goal

Add one reusable `.grid` utility (plus a `.grid__full` span helper) and
have Dashboard and Análise lay their cards into it: one column on
narrow viewports, two (or more) on wide, source order preserved. A
handful of naturally-wide cards span the full width.

## Non-goals

- No new dependency, no new component.
- No content redesign: the 4 Dashboard figures stay in their single
  `.card row` (they already wrap into a strip); charts are not
  re-drawn; no card is split, merged, or re-worded.
- No content-width change — `.main > *` stays `max-width: 1080px`.
- No per-page media queries — the grid is intrinsically responsive.
- `ConsultorIA` and `AiUsageSection` on Análise stay as they are:
  full-width, stacked below the grid, outside the `AsyncBoundary`.
- No change to `theme.test.ts` beyond adding the two class names to the
  vocabulary list.

## 1. New CSS (`frontend/src/theme.css`)

Append to the layout block:

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

- `repeat(auto-fit, minmax(320px, 1fr))` → the browser fits as many
  320px-min columns as the container allows, stretching them to fill.
  Content area is ≤ 1080px, so this is 2 columns above ~680px of
  available width and 1 column below — no explicit breakpoint needed.
- `align-items: start` keeps a short card from stretching to match a
  tall neighbour in the same row.
- `gap: var(--space-4)` matches the `.stack` gap the pages use today,
  so vertical rhythm is unchanged when the grid collapses to one
  column.

## 2. `DashboardPage.tsx`

Inside the `AsyncBoundary`, the wrapper changes and three children gain
`grid__full`; nothing else moves.

- `<div className="stack">` → `<div className="grid">`
- `<p className="subtle">{summary.month}</p>` → add `grid__full`
  (`className="subtle grid__full"`) — the month label sits on its own
  line above the tiles.
- the stat card `<div className="card row">` → add `grid__full`
  (`className="card row grid__full"`) — the four figures stay a
  full-width strip at the top.
- the Alertas card (`{summary.alerts.length > 0 && (<div className="card">…`)
  → add `grid__full` — a callout reads better full-width.

The remaining cards — Gastos por categoria, Evolução (6 meses),
Últimos gastos, Metas em andamento, Parcelas ativas (conditional),
Fechamento do mês — are untouched and tile two-up in source order. The
conditional "Parcelas ativas" card simply occupies a cell when present;
`auto-fit` reflows without it.

## 3. `AnalisePage.tsx`

Inside the `AsyncBoundary`, wrap the four existing cards (Resumo,
Gastos por categoria, Projeção 12 meses, Cenários) in a single
`<div className="grid">`. They tile two-up. No card needs
`grid__full`. `</AsyncBoundary>` then `<ConsultorIA />` and
`<AiUsageSection />` stay exactly where they are — direct children of
`<div className="page">`, full-width, stacked with the page's own
`gap: var(--space-5)`.

The `<AsyncBoundary … skeletonRows={4}>` stays; its skeleton renders
before the grid wrapper, unchanged.

## 4. Charts inside narrower columns

`.dash-evo` (height 90px) and `.chart-svg` (height 80px) both use
`viewBox` + `preserveAspectRatio="none"`, so in a ~520px column they
render denser rather than clipped. Acceptable — no change. The bar
breakdowns (`BarBreakdown`) are fluid width already.

## Files

**Modified:**
- `frontend/src/theme.css` — `.grid` + `.grid__full`.
- `frontend/src/theme.test.ts` — vocabulary list += `.grid`, `.grid__full`.
- `frontend/src/pages/DashboardPage.tsx` — `.stack` → `.grid`; three
  `grid__full` additions.
- `frontend/src/pages/AnalisePage.tsx` — wrap the four boundary cards
  in `<div className="grid">`.
- `frontend/src/pages/DashboardPage.test.tsx`,
  `frontend/src/pages/AnalisePage.test.tsx` — one assertion each that
  the `.grid` container renders once the page has loaded.

**No new files.**

## Tests

- **`theme.test.ts`** — `.grid` and `.grid__full` added to the
  "defines the class vocabulary" list.
- **`DashboardPage.test.tsx`** — after the summary loads,
  `container.querySelector('.grid')` is non-null and the stat card
  (`container.querySelector('.card.row.grid__full')`, or the element
  containing "Receita do mês") carries `grid__full`.
- **`AnalisePage.test.tsx`** — after load,
  `container.querySelector('.grid')` is non-null and contains the
  "Resumo" heading.
- Every existing Dashboard / Análise test passes unchanged — all
  assertions are on headings, text, roles, and testids, none of which
  the grid wrapper changes.

## Verification

- `cd frontend && npm test` green; `tsc -p tsconfig.json --noEmit`
  clean; `npm run build` exit 0.
- `cd server && npm test` unchanged; `bash scripts/qa-e2e.sh` unchanged.
- Rebuild + `launchctl kickstart` + browser:
  - Desktop (~1280px): Dashboard shows the month label and stat strip
    full-width, then the remaining cards in two columns; Análise shows
    Resumo + category chart on row one, Projeção + Cenários on row two,
    ConsultorIA + AiUsage full-width below.
  - Narrow (~500px): both pages collapse to a single column identical
    to today's layout, same vertical spacing.
  - Light and dark unchanged.
