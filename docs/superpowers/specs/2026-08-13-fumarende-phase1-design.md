# fumarende — Phase 1 design: server rebuild of Stacks

## Context

Stacks is an existing personal finance tracker for single-user, private use,
tracking income, expenses, USD/BRL currency exchange, savings, an emergency
fund, goals, and special projects. Two prior implementations exist and are
kept as reference only (not built on directly):

- `stack-project/prototype/stacks.html` — a single-file client-side app
  (File System Access API for persistence). The original validated feature
  and behavior reference.
- `stack-project/app/` — an in-progress Tauri desktop rewrite (Rust +
  SQLite/sqlcipher backend) implementing several modules with a proven
  schema and business logic (installment grouping, savings rollover,
  emergency-fund averaging).

This project (`fumarende`) is a fresh rewrite, not a continuation of either.
It reuses their validated data model and behavior as reference but replaces
the desktop-app architecture with a persistent local server reachable by URL
from any device on the owner's home network — motivated by a recent large
income change (new job, ~2x income, paid in USD, converted to BRL monthly
via câmbio contracts) that calls for rebuilt financial infrastructure, not
just a continuation of the old prototype.

Full Claude API integration (PDF statement import, auto-categorization,
on-demand câmbio/spending/macro analysis, cost tracking) is the explicit
next phase and is intentionally out of scope for this design — see Roadmap.

## Goals (Phase 1)

- Replace the Tauri prototype for daily use: same functional coverage,
  reachable from any device on the home network via a URL, not just one
  machine.
- Preserve every data-integrity guarantee the prototype already has: no
  silent data loss, backups before destructive operations, soft monthly
  close as a review rather than a lock.
- Establish a stable data model and API surface that Phase 2 (Claude
  integration) builds on without a schema rewrite.

## Non-goals (Phase 1)

- No Claude/AI features of any kind (extraction, categorization, analysis,
  recommendations). See Roadmap.
- No PDF or CSV import — expense/income entry is manual only in Phase 1.
- No Open Finance / bank API connections.
- No multi-user support, no accounts beyond the single shared password.

## Architecture

- **Backend:** Node.js + TypeScript, Fastify (native TS support, built-in
  schema validation).
- **Database:** SQLite via `better-sqlite3`, single file under
  `~/Library/Application Support/fumarende/`.
- **Frontend:** React + Vite, single-page app, built in the "Pulse" visual
  direction (dark background, monospace type, cyan/purple accents —
  selected from `stack-project/design/previews/preview_2_pulse.html`).
- **Deployment:** one Node process serves both the API (`/api/*`) and the
  built frontend static assets — a single deployable, no separate frontend
  server.
- **Process persistence:** a macOS launchd user agent
  (`~/Library/LaunchAgents/com.lucca.fumarende.plist`) with `RunAtLoad` and
  `KeepAlive` set, so the server starts on login/boot and restarts on
  crash without manual intervention.
- **Network access:** binds to `0.0.0.0` on a fixed port (e.g. `4173`),
  reachable on the LAN via the Mac's Bonjour hostname (e.g.
  `http://luccas-mac.local:4173`) — no static IP bookkeeping required.
- **Auth:** a single shared password set on first run, stored as a salted
  hash. A login screen gates the whole app; a successful login sets a
  long-lived `httpOnly` session cookie per device. Plain HTTP is accepted
  for Phase 1 — the password's purpose is to stop casual access from other
  devices on the home Wi-Fi, not to defend against an adversary already on
  the network, which is a reasonable bar for this use case.

## Data model

SQLite schema, carried over from the validated `stack-project/app`
migrations with no structural changes. Money is stored as integer cents
throughout. Every table uses soft deletes (`deleted_at`) rather than hard
deletes.

- **`income`** — date, `amount_brl_cents` (required), `amount_usd_cents`
  (nullable — null means a plain BRL entry with no currency conversion),
  description, source, optional `exchange_contract_id` linking to the
  câmbio contract that produced it.
- **`exchange_contracts`** — its own category, separate from `income`:
  date, USD amount, PTAX rate, contracted rate, IOF, bank fee, net BRL,
  institution, operation type, source reference.
- **`expenses`** — date, description, amount, category, `type`
  (essencial/não-essencial), payment method, `installment_number` /
  `installment_total` / `installment_group_id`. Each installment is a
  distinct row scoped to its own month; the shared `installment_group_id`
  ties the group together for display/tracking without double-counting.
- **`fixed_expenses`** — recurring-expense templates. An "apply to month"
  action stamps all active templates into `expenses` for a given month in
  one click.
- **`emergency_fund_entries`** + **`savings_monthly_targets`** — a single
  savings ledger (Poupança and Reserva are merged, matching the existing
  app's design — one pot, not two disconnected ones) with a monthly target
  (percentage or fixed amount) and deficit-only rollover.
- **`goals`** — name, target/current amount, target date, status.
- **`special_projects`** — name, target/current amount, target date,
  notes, status — kept distinct from goals (larger, one-off efforts vs.
  personal targets).
- **`category_rules`** — keyword → category. Schema is stable in Phase 1;
  the rule-matching logic that consumes it for auto-categorization is a
  Phase 2 feature.
- **Monthly close** — a per-month reviewed flag/timestamp. Purely
  informational: reviewing a month never locks or blocks editing past
  entries.

## Modules / UI (Phase 1 scope)

Every module from the prototype carries forward as a page, same functional
split as today:

- **Dashboard** — monthly overview, alerts, upcoming installments,
  soft-close status.
- **Receitas** — income entries.
- **Câmbio** — exchange contract entries (manual only — PDF import is
  Phase 2), spread/IOF math, PTAX rate reference.
- **Gastos** — expense entries: category, payment method, installments.
- **Parcelas** — cross-month installment view, grouped by
  `installment_group_id`.
- **Reserva** — deposits/withdrawals, monthly savings target, deficit
  rollover, target based on historical essential-expense average.
- **Metas** / **Projetos Especiais** — target vs. current tracking.
- **Análise / Projeção / Cenários** — the existing deterministic
  (non-AI) projection and what-if tooling, kept as-is. Distinct from the
  Claude-powered analysis planned for Phase 2 — same name, different
  mechanism (formulas, not AI judgment).
- **Histórico Dólar** — USD/BRL rate history.
- **Backup & Dados** — manual export/import, diagnostics, danger zone
  (wipe data), test-data mode.

**Known Phase 1 gap:** the prototype's CSV import and the planned PDF
import both depend on Claude extraction (Phase 2). Phase 1 therefore has
no statement import of any kind — expense/income entry is manual only.
This was discussed and explicitly accepted: Phase 1 ships with fast manual
entry, and Phase 2 (built immediately after) removes the gap.

## Data integrity & testing

- Soft-delete everywhere; no hard `DELETE` from user-facing actions.
- Automatic timestamped backup of the SQLite file before any destructive
  operation (wipe, restore-from-backup, schema migration).
- The server must never auto-save or otherwise persist state if the
  database failed to load or is in an unknown condition — an empty or
  partial in-memory state can never overwrite good data on disk.
- Backups stay on the local machine in Phase 1 (not synced off it), so no
  encryption-at-rest requirement yet. This becomes relevant only if/when
  backups leave the machine (e.g. a future off-site sync), which is
  explicitly out of scope here.
- Unit tests (Vitest) for the business logic with proven edge cases:
  cents-based money arithmetic, installment grouping (no double-counting
  across months), emergency-fund essential-expense averaging, savings
  deficit-only rollover.
- A manual QA checklist adapted from `stack-project/docs/qa-checklist.md`,
  updated for the new server/auth/network-access model (e.g.
  "survives a launchd restart" replaces "survives File System Access
  reconnect").

## Roadmap beyond Phase 1

Each phase below gets its own brainstorm → spec → plan cycle when reached;
they are documented here only to record direction, not to specify.

**Phase 2 — Claude integration:**
- PDF statement import (Banco Inter, Santander, Bradesco) via Claude
  extraction into structured transactions.
- Categorization: `category_rules` table matches known merchants instantly
  and for free; unrecognized merchants fall back to Claude during the same
  import call, with the result saved back as a new rule.
- On-demand analysis (triggered by the user, not scheduled or continuous):
  câmbio conversion recommendation using Claude with the API's web search
  tool for macro/geopolitical context, spending pattern analysis, and a
  savings-aggressiveness dashboard flag with a suggested target
  adjustment.
- In-app running cost tracker for Claude API spend.

**Phase 3 — unscoped:**
- Open Finance bank connections, if a reasonably priced option exists,
  replacing manual/PDF import entirely.

## Repository

Public GitHub repository named `fumarende`. Only application code and docs
are published — the SQLite database, `.env`/API keys, and backups are
git-ignored and never committed.
