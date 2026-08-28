# fumarende — QA checklist

> **Automated coverage.** `scripts/qa-e2e.sh` boots an isolated copy of
> the built server (throwaway DB, port 4199) and runs a 95-assertion
> end-to-end pass over every module's API. Last run 2026-08-29:
> **95/95 pass.** Unit + integration suites: **server 177, frontend 99,
> all green.** Items below are marked `[x]` when the e2e run or a unit
> test verifies them; `[ ]` items are browser-visual checks only a human
> can confirm.

## Foundation

- [x] `curl http://localhost:4173/api/health` returns `{"ok":true}`
      (e2e; live server also verified).
- [ ] From another device on the same Wi-Fi, `http://<mac-hostname>.local:4173`
      loads the login/setup screen in a browser.
- [x] First visit shows the password **setup** form, not login
      (`auth/status` reports `passwordSet:false` before setup — e2e).
- [x] After setup, reloading the page stays logged in — session cookie
      persists (`auth/status` reports `authenticated:true` with the
      cookie — e2e).
- [x] Logging out returns to the login form, not setup (`auth/status`
      reports `authenticated:false`, `passwordSet` stays true — e2e).
- [x] Entering the wrong password is rejected and does not log in
      (login with a bad password → 401 — e2e).
- [ ] Adding a Receitas entry appears in the list immediately without a
      manual refresh (browser).
- [x] Killing the server process results in it being relaunched
      automatically (`KeepAlive`) — observed during this QA run: the
      launchd server was killed and relaunched within a second.
- [ ] Rebooting the machine brings the server back up without any manual
      step (`RunAtLoad`).

## Câmbio

- [ ] Câmbio page loads from the nav (no longer "em breve") (browser).
- [ ] Typing USD amount + contracted rate shows the live preview
      (BRL bruto / IOF+tarifas / BRL líquido / VET / spread) (browser;
      the underlying `calcCambio` math is unit-tested both sides).
- [x] Leaving PTAX blank still saves — a contract with no ptax/iof/fee
      is accepted with 0 defaults (e2e).
- [x] A submitted contract's net BRL is computed server-side — the
      $5,000 @ 5.0994 / IOF 653.18 / fee 30 vector stores
      `netBrlCents = 2 481 382` (e2e; matches the unit tests).
- [x] Deleting a contract removes it from the list (e2e).
- [x] An invalid entry is rejected and saves nothing — bad
      `operationType`, `amountUsdCents: 0`, and non-numeric
      `contractedRate` all → 400 (e2e).
- [x] Receitas accepts and round-trips a USD amount + source alongside
      the BRL amount (e2e). The parenthesised display is browser-visual.

## Gastos + Parcelas

- [ ] Gastos page loads from the nav (browser).
- [x] A one-off expense is created and listed (e2e). The totals card
      recomputing live is browser-visual (the `spendingBreakdown` math
      is unit-tested).
- [x] An expense with N parcelas creates N rows dated one month apart
      (day-clamped), each labelled `i/N`, summing **exactly** to the
      purchase amount — `65 000` over 3 →
      `[21 668, 21 666, 21 666]` on `2026-01-15 / 02-15 / 03-15`,
      sharing one group id (e2e).
- [x] Deleting a non-installment expense removes just that row (e2e).
- [x] Deleting an installment expense removes the whole group —
      `DELETE /api/expenses/group/:id` clears all 3, leaving the one-off
      (e2e).
- [ ] Parcelas page shows one row per installment purchase with the paid
      count and remaining BRL (browser; the `groupInstallments` rollup
      is unit-tested).
- [x] Adding a fixed expense and applying it to a month creates one
      expense dated the 1st; applying again creates none (idempotent) —
      `{created:1}` then `{created:0}` (e2e).
- [x] An invalid expense is rejected and saves nothing — bad `type`
      → 400 (e2e).

## Reserva

- [ ] Reserva page loads from the nav (browser).
- [ ] With no essential expenses, the status card shows the "registre
      seus gastos essenciais" prompt (browser; `reserveTiers` no-data
      branch is unit-tested).
- [x] A deposit and a withdrawal net to a plain sum, with the withdrawal
      stored negative — `+700 000` and `−200 000` → balance `500 000`
      (e2e).
- [ ] A withdrawal larger than the current balance shows the inline
      warning but still records (browser; the warning is advisory).
- [x] Setting the Meta Mensal to a % resolves against that month's
      Receitas income — 20% of `1 000 000` June income →
      `targetCents = 200 000`; a fixed value uses that value as-is —
      `fixedValueCents: 120 000` → `targetCents = 120 000` (e2e).
- [x] A month's target is frozen on first view — the July target
      inherits June's 20% setting and carries `rolloverCents = 50 000`
      (June's 200 000 target minus 150 000 saved) (e2e; the
      adding-income-later-doesn't-change-it case is unit-tested).
- [x] `GET /api/savings-target` rejects a malformed month; `PUT` rejects
      a `pctOrFixed` other than pct/fixed (e2e).
- [ ] Deleting a history entry updates the balance without a refresh
      (browser).

## Metas + Projetos Especiais

- [ ] Both pages load from the nav (browser).
- [x] Creating a goal returns 201 and lists it with `status: 'active'`;
      the current/target/date fields round-trip (e2e). The progress bar
      and "Faltam …" line are browser-visual (`targetProgress` is
      unit-tested).
- [ ] With a future "data alvo", the card shows a "sugestão R$ X/mês"
      (browser; `targetProgress` computes it — unit-tested).
- [x] "Adicionar" raises the current amount — `POST /:id/add
      {deltaCents}` increments `currentCents`; a non-positive delta
      → 400 (e2e).
- [x] "Editar" can change name / target / current amount / date —
      `PATCH /:id` applies the provided keys (e2e).
- [ ] When current reaches the target the card shows "Concluída" and
      drops the suggestion line (browser; `targetProgress.complete` is
      unit-tested).
- [x] "Excluir" removes the goal (e2e).
- [x] Projetos Especiais round-trips a "Motivação" (notes) value; Metas
      ignores notes entirely (always `null`) (e2e). The italic-quote
      rendering is browser-visual.
- [x] Bad input is rejected — blank name and `targetCents: 0` both
      → 400 (e2e).

## Análise

- [ ] Análise page loads from the nav (browser).
- [x] All six input endpoints the page reads (`/api/income`,
      `/api/expenses`, `/api/emergency-fund`, `/api/savings-target/:month`,
      `/api/goals`, `/api/special-projects`) return 200 with the session
      cookie (e2e).
- [x] The analysis math — `spendingBreakdown` (totals + essencial split
      + sorted category breakdown), `projectSavings` (12 linear months +
      endpoints + flat-when-target-0), `scenarioCatalog` (não-essencial
      only, month-averaged, sorted), `applyCuts` (sum + annualise) — is
      covered by **16 unit tests (8 server + 8 frontend)**.
- [ ] "Gastos por categoria" shows one bar per category, largest first,
      widths proportional (browser).
- [ ] "Projeção 12 meses" shows a year-end total and a rising line when
      a savings target is set; shows the "Configure sua meta mensal"
      note when it is 0 (browser).
- [ ] "Cenários" lists each não-essencial category with a 0–100% slider;
      moving a slider updates the "Corte total …/mês · … em 12 meses"
      line (browser; `applyCuts` is unit-tested).
- [ ] With no expenses, the category and cenários sections show their
      empty-state text (browser).

## Histórico Dólar

- [x] Migration `002_dollar_quotes` applies automatically on server
      restart — the live DB's `schema_migrations` now has both `001` and
      `002` and the `dollar_quotes` table exists (verified this run).
- [x] Registering a month and re-registering it replaces the row in
      place (one row per month); the salary clears to null when omitted
      on the second `PUT` (e2e).
- [x] Bad input is rejected — malformed month in the URL and `rate: 0`
      both → 400 (e2e); the `quoteStats` derivations (average, vs-média
      %, salário em BRL) are covered by 4 unit tests (2 server + 2
      frontend).
- [x] `DELETE` removes the month, tolerating an empty JSON body (e2e).
- [ ] The rate line chart appears once two or more months are recorded
      (browser).
- [ ] The table shows Cotação (4 dp), Salário (US$), Salário (R$) =
      salário × cotação, and the vs-média % (browser).
- [ ] Leaving the salary field blank shows "—" for that month's Salário
      columns (browser).

## Backup & Dados

- [x] `GET /api/data/export` returns a JSON snapshot with an
      `attachment` content-disposition; `GET /api/data/diagnostics`
      returns a `rowCounts` object + migration list (e2e).
- [x] Export → wipe (`confirm: APAGAR TUDO`) → import round-trips the
      data back to its pre-wipe row count; a wrong phrase → 400 (e2e; the
      import/export/wipe modules also have unit round-trip tests).
- [x] `seed-test` behind the same phrase replaces all data with the
      three-month fixture and is deterministic across runs (e2e + unit).
- [x] `PUT`/`GET`/`DELETE /api/monthly-close/:month` mark, list, and
      clear a month's reviewed flag; a bad month → 400 (e2e).
- [x] Migration list, DB size, and backup count surface in diagnostics
      (unit; verified against a real temp dir).
- [x] `DATA_TABLES` is drift-guarded — a test fails if a migrated table
      is not listed (covers `ptax_rate_cache`; excludes `sqlite_sequence`).
- [ ] The page's Diagnóstico card, download button, import file flow,
      danger-zone phrase gate, and monthly-close checkboxes work in the
      browser (all four are component-tested; a manual pass is optional).

## Dashboard

- [x] `GET /api/dashboard` → 401 unauth; authenticated → a summary with
      a `YYYY-MM` `month`, a 6-entry `evolution`, and an `alerts` array
      (e2e).
- [x] After `seed-test`, the summary's month income and expenses are
      `> 0` and `installments.activeGroups >= 1` (e2e).
- [x] `dashboardSummary` — month totals, essencial split, previous-month
      deltas, byCategory sort, savings-target / thin-reserve /
      over-spend / installment-spike / câmbio-spread-drift alerts,
      6-month evolution, monthly-close read — 9 unit tests.
- [ ] The stat cards, delta arrows, alert tints, category bars,
      evolution lines, recent-expense rows, goal bars, and the
      "Fechamento do mês" toggle render in the browser (component-tested;
      manual pass optional).
