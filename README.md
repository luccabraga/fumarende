# fumarende

A personal finance web app: income (USD, paid remotely), monthly câmbio
(USD→BRL) conversion tracking, BRL credit card spending, savings, an
emergency fund, goals, and special projects — run as a persistent local
server reachable by URL from any device on the owner's home network.

## Status

**Phase 1 complete** — all eight modules (Receitas, Câmbio, Gastos /
Parcelas / Fixos, Reserva, Metas / Projetos, Análise, Histórico Dólar,
Backup & Dados) plus the Dashboard and a nav-shell month selector, on a
Node/TypeScript + Fastify + better-sqlite3 server with a React/Vite
frontend. Runs as a launchd service at `http://localhost:4173`.

**Phase 2 complete** — Claude API integration, in four slices:

1. **Foundation + on-demand analysis** ✅ — a raw-`fetch` Claude client,
   a `claude_api_calls` / `ai_analyses` ledger, a soft monthly spend
   cap, and three preset read-only analyses in a "Consultor IA" card on
   the Análise page.
2. **Auto-categorization** ✅ — a free keyword-rule pass then a Haiku
   fallback for unknown merchants (which learns a new rule), on expense
   create and via a "Categorizar pendentes" sweep; a "Regras de
   categoria" management section on the Gastos page.
3. **PDF statement import** ✅ — upload a credit-card statement PDF;
   `claude-sonnet-5` reads it natively and extracts the line items into
   a review table (editable, checkboxes, kind badges, duplicate flags);
   confirmed rows become categorized expenses. "Importar extrato (PDF)"
   section on the Gastos page. No stored PDFs.
4. **Câmbio web-search + cost tracker** ✅ — an opt-in "com contexto de
   mercado" checkbox lets the câmbio analysis use Anthropic's web-search
   tool for the live USD/BRL rate, trend, and news
   (`FUMARENDE_AI_WEB_SEARCH=on|off`, `max_uses` 3). A "Uso da IA"
   section on the Análise page shows month-to-date spend, a by-kind
   breakdown, and the last 20 calls.

**Phase 2.5 — UX/UI polish** is underway, decomposed into sub-slices:

- **2.5.1 Design system foundation** ✅ — bundled fonts (Space Grotesk,
  JetBrains Mono), an expanded light/dark token system with a persisted
  `Sistema / Claro / Escuro` toggle, a reusable class vocabulary
  (`.btn*`, `.field*`, `.page-title`, `.stack`, `.row`, …), and a
  responsive nav (top-bar + hamburger below ~800px). `NavShell`,
  `LoginPage`, and `DashboardPage` migrated to the classes as a proof.
- **2.5.3 States & feedback** ✅ — a `useResource` hook + `<AsyncBoundary>`
  give every page a pulsing skeleton and an error card with **Recarregar**;
  a `ToastContext` shows success/failure toasts; `<EmptyState>` replaces the
  ad-hoc "Nenhum…" lines; the five value-entry forms validate per-field on
  blur (inline `field-error` + `aria-invalid`); the PDF import shows an
  indeterminate bar, an elapsed-seconds counter, and a **Cancelar** that
  aborts the client request.
- **2.5.2 Styling convention** ✅ — every remaining inline `style={{}}`
  (~180 across 17 files) replaced by the class vocabulary, extended with
  `.page` / `.page-header*` / `.form-grid` / `.list-row` / `.data-list` /
  `.data-table` / `.chart-svg`; a `<PageHeader title subtitle? actions?>`
  component; section headings, card gaps, list-row padding, and helper
  text snapped to the scale. Only computed values, a few layout
  constraints, and the shared link-style Excluir buttons remain inline.
- **2.5.4 Accessibility audit** ✅ — a skip link + labelled landmarks +
  `<main id tabIndex>`; `:focus-visible` broadened to every control and
  the inline link-buttons folded into a `.link-btn` class; `aria-expanded`
  on the disclosure toggles; `aria-describedby` linking field errors to
  their inputs; `scope="col"` + `sr-only` captions on the data tables;
  five light tokens (+ dark `--text-subtle`) retuned to clear WCAG AA
  4.5:1, locked with a computed contrast test; on route change the tab
  title updates and focus moves to `<main>`.
- **2.5.5** dashboard / análise grid pass — next.

Set `ANTHROPIC_API_KEY` in `server/.env` to enable the AI features;
without a key every AI route returns a clean "not configured" response
and categorization falls back to rules only.

**Phase 2.5 — UX/UI polish** (its own brainstorm → spec → plan cycle,
after the Phase 2 Claude slices). A dedicated pass on look, feel, and
usability now that the feature set is stable:

- **Design tokens + a real stylesheet** — replace the scattered inline
  `style={{}}` objects and repeated magic numbers with CSS custom
  properties and utility classes.
- **Responsive / mobile** — the app is opened from a phone on the home
  network, but layouts assume desktop (fixed 224px sidebar, wide
  flex-wrap forms). Real breakpoints and a collapsible nav.
- **Navigation grouping** — 11 flat sidebar items → grouped sections
  (Entradas / Gastos / Reserva & Metas / Análise / Config).
- **Forms** — field grouping, inline per-field validation, clearer
  success/error feedback.
- **Page hierarchy** — Dashboard and Análise are long card stacks;
  introduce a grid and stronger visual hierarchy.
- **Loading / empty states** — pages currently render `null` while
  fetching.
- **Consistency audit** — heading sizes, button labels, and card
  spacing drift between modules.
- **Accessibility** — contrast, focus states, keyboard nav; wire up the
  light/dark toggle the palette already supports.

Sits before Phase 3 (Open Finance); can be pulled forward if the UI
starts getting in the way of daily use.

Design specs and implementation plans live under `docs/superpowers/`.

## Repo layout

Populated as implementation starts. `docs/superpowers/` holds design specs
and implementation plans, following the
[Superpowers](https://github.com/obra/superpowers) brainstorm → spec →
plan → implement workflow.
