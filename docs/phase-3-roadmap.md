# Phase 3 — Open Finance: roadmap & decision log

**Status: PAUSED before implementing 3.1.** This file preserves the
decisions taken in the 2026-09-02 brainstorm so work can resume from
exactly here. No 3.1 spec has been written yet; no code has changed.
The last shipped work is Phase 2.5.5 (`main` @ `c561c6d`).

## Spike outcome — provider choice (2026-09-02)

Real Open Finance participation requires being a Banco Central–regulated
institution — not viable for a personal app. The practical route is a
third-party aggregator that is itself a regulated participant.

| Option | Cost | Verdict |
|---|---|---|
| Pluggy **Dados** (commercial) | from R$ 2.500/month | rejected — far out of scope |
| Belvo | sales-quote, production is paid | rejected |
| **Meu Pluggy** (Pluggy's free personal tier) | **R$ 0, indefinite, no CNPJ** | **chosen** |

**Meu Pluggy** is Pluggy's free-forever tier for individuals pulling
*their own* bank data into personal tools. Non-commercial use only
(fine — the running instance is personal; the public repo is just
code). No documented connection/request limits while all accounts are
the user's own. Returns checking/savings accounts, credit cards,
transactions, loans, balances. Pluggy refreshes from the banks daily.

**Personal path avoids building any consent UI:** the user connects
banks once at meu.pluggy.ai (Open Finance redirect — *not* the
password/scraping connector), which yields **Item IDs**; the Pluggy
dashboard gives a **Client ID + Client Secret**; fumarende stores those
three values in `server/.env` (gitignored, like `ANTHROPIC_API_KEY`)
and calls Pluggy's REST API server-side. Prior art: Actual Budget's
Pluggy bank-sync works exactly this way.

**Accepted caveats:** non-commercial only; a manual `.env` setup step;
Open Finance consents expire (~annually) and are renewed at
meu.pluggy.ai (the Item keeps its ID); daily refresh cadence, not
real-time; Pluggy holds a copy of the transaction data (read-only —
Meu Pluggy cannot initiate payments).

## Sub-project decomposition

Each sub-project is its own spec → plan → implement cycle.

| # | Sub-project | Delivers |
|---|---|---|
| **3.1** | Pluggy client + raw sync | `PluggyConfig` from env; `server/src/pluggy/` client (auth, items, accounts, transactions); migration `004_pluggy` with raw `pluggy_accounts` + `pluggy_transactions` tables; `POST /api/pluggy/sync` on-demand pull; minimal `/contas` status stub. Does **not** touch real Gastos/Receitas. |
| **3.2** | Scheduled sync + item lifecycle | daily auto-sync; detect `LOGIN_ERROR` / expired consent / `WAITING_USER_INPUT` (MFA) and surface "reconnect at meu.pluggy.ai". |
| **3.3** | Reconciliation + categorization | match raw `pluggy_transactions` against existing manual/PDF `expenses` / `income` (date + amount + fuzzy description); run genuinely-new debits through the 2.2 categorize pipeline, credits → income; confirm/edit/dismiss review queue like the PDF importer; on confirm, create the real row and set `imported_expense_id` / `imported_income_id`. |
| **3.4** | "Contas conectadas" page | full UI: balances, last-sync, "Sincronizar agora", the review queue, hide/disconnect account, sync-error banners. |

## 3.1 — scoping decisions already made (2026-09-02)

These were confirmed; the detailed 3.1 design was presented in chat and
still needs to be written up as a proper spec when work resumes.

- **Sync trigger:** on-demand "Sincronizar agora" button only
  (`POST /api/pluggy/sync`). No `PATCH /items/:id` refresh trigger in
  3.1 — rely on Pluggy's own daily refresh. Scheduling is 3.2.
- **Sync scope:** accounts + transactions. First run pulls the full
  available history (~12 months, Open Finance regulatory max; some
  banks less). Later runs pull only transactions newer than the last
  seen per account (re-pull a small recent window to catch
  pending→posted revisions).
- **3.1 UI:** minimal stub only — a `/contas` page showing
  configured-or-not, connected accounts with balance + last-sync, and
  the sync button with result counts. The polished page is 3.4.

## 3.1 — design sketch presented in chat (NOT yet a spec)

Recorded for continuity; re-confirm before writing the spec.

- **Config:** `PluggyConfig { clientId, clientSecret, itemIds[], baseUrl }`
  from `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` / `PLUGGY_ITEM_IDS`
  (comma-separated) / default `https://api.pluggy.ai`. `configured` =
  all three present. `buildApp(..., pluggyConfig = NOT_CONFIGURED_PLUGGY)`
  as a 5th positional arg, mirroring `aiConfig`.
- **Client** (`server/src/pluggy/client.ts`, raw `fetch`, injectable
  `fetchImpl`): `authenticate()` → `POST /auth` → `{ apiKey }` cached
  ~110 min, re-auth on 401; `getItem(itemId)`; `listAccounts(itemId)`;
  `listTransactions(accountId, {from,to,page})` (500/page, caller
  loops). Errors: `PluggyNotConfiguredError`, `PluggyUpstreamError(httpStatus)`.
- **Migration `004_pluggy`:**
  - `pluggy_accounts` — `pluggy_account_id` (unique), item_id, name,
    type (BANK|CREDIT), subtype, currency_code, `balance_cents`,
    connector_name, last_synced_at, created_at.
  - `pluggy_transactions` — `pluggy_transaction_id` (unique),
    pluggy_account_id, date (`YYYY-MM-DD`), description, `amount_cents`
    (absolute magnitude), `kind` (`credit`/`debit` from Pluggy's
    `type`), currency_code, `pluggy_category` (raw string), `raw_json`,
    `imported_expense_id`, `imported_income_id` (both NULL until 3.3),
    created_at, updated_at. Index on `(pluggy_account_id, date)`.
  - Both added to `DATA_TABLES` (wipe / export / import / diagnostics)
    and `TABLES_WITHOUT_DELETED_AT`.
- **Sync** (`server/src/pluggy/sync.ts`) `syncPluggy(db, cfg, deps?)`:
  authenticate → per item: `getItem` (error status → record string,
  skip, add to `warnings`); `listAccounts` → upsert; per account: `from`
  = last stored tx date − 5 days (or 12 months ago on first run), loop
  transaction pages, upsert by `pluggy_transaction_id` (on conflict
  update description/amount/kind/category/raw + `updated_at`, **never**
  touch `imported_*`). All writes in one `db.transaction()` after
  fetches resolve. Returns `{ accounts, transactionsNew,
  transactionsUpdated, warnings }`. `amount_cents =
  round(abs(tx.amount) * 100)`; `kind = tx.type === 'CREDIT' ? 'credit'
  : 'debit'`; `date = tx.date.slice(0,10)`.
- **Routes** (`registerPluggyRoutes(app, db, pluggyConfig)`, behind
  `requireAuth`): `GET /api/pluggy/status` → `{ configured, itemCount,
  accounts:[…balance, lastSyncedAt], transactionCount, lastSyncAt,
  unreconciledCount }` (`configured:false`, no error, when unset);
  `POST /api/pluggy/sync` → runs the sync; 503 not-configured, 502
  upstream, else the counts.
- **Frontend:** `api.ts` `getPluggyStatus()` / `syncPluggy()` + types;
  new `/contas` page (`ContasPage`) with `useResource` + `AsyncBoundary`
  — not-configured → `<EmptyState>` naming the three `.env` vars +
  meu.pluggy.ai link; configured → `.grid` of account cards + a
  "Sincronizar agora" button (toast with counts + warnings) + "N
  transações · M não reconciliadas". `App.tsx` route, `NavShell` link,
  `RouteEffects` `PAGE_TITLES['/contas'] = 'Contas conectadas'`.
- **Tests:** `pluggy/client.test.ts`, `pluggy/sync.test.ts`,
  `routes/pluggy.test.ts` (integration, stubbed Pluggy),
  `ContasPage.test.tsx`; `qa-e2e.sh` gets a "Pluggy not configured"
  block (`status` → 200 `configured:false`, `sync` → 503); `data`
  module tests extended for the two new tables.
- **Not in 3.1:** `PATCH /items/:id` refresh · scheduled sync (3.2) ·
  reconciliation / categorization / creating real expenses (3.3) ·
  polished UI / disconnect / per-item error banners (3.4) · webhooks ·
  investments & loans products.

## User setup task (in parallel, not blocking)

1. Sign up at meu.pluggy.ai; connect bank(s) via the Open Finance
   redirect (not the password/scraping connector).
2. At dashboard.pluggy.ai create an application → copy Client ID +
   Client Secret.
3. From Meu Pluggy copy each connection's Item ID.
4. Provide the three values → they go in `server/.env`. All code is to
   be built to run fine without them ("not configured" state).

## Resume checklist

1. Re-read this file.
2. Confirm the 3.1 design sketch above still holds (adjust if desired).
3. `superpowers:writing-plans` is not yet started — begin with a proper
   3.1 spec (`docs/superpowers/specs/YYYY-MM-DD-pluggy-raw-sync-design.md`),
   then plan, then implement.
