# fumarende — QA checklist

> **Automated coverage.** `scripts/qa-e2e.sh` boots an isolated copy of
> the built server (throwaway DB, port 4199, no API key) and runs a
> 133-assertion end-to-end pass over every module's API. Last run
> 2026-09-01: **133/133 pass.** Unit + integration suites: **server 269,
> frontend 161, all green.** Items below are marked `[x]` when the e2e
> run or a unit test verifies them; `[ ]` items are browser-visual
> checks only a human can confirm.

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

## Month selector (nav shell)

- [x] `GET /api/dashboard?month=2026-06` returns a summary whose `month`
      is `2026-06`; `?month=nope` → 400 (e2e).
- [x] `dashboardSummary({ month })` computes for that month (prev month,
      evolution end, sums) and falls back to the current month on a
      malformed value (2 unit tests).
- [x] `MonthContext` — defaults to the current month, honours a valid
      stored value, `setMonth` persists to `localStorage`, `months` is
      the sorted-desc union incl. the current + active month, and a
      failed `listMonthlyClose` degrades to `[month]` (5 unit tests).
- [x] `NavShell` renders the `Mês` select and persists a change (unit);
      `App` mounts one `Mês` select on the shell (unit).
- [x] `DashboardPage` requests the dashboard for the stored month (unit).
- [ ] Changing the Mês dropdown updates the Dashboard, Reserva "Meta
      Mensal", and Análise views; the list pages are unaffected; the
      choice survives a reload (browser).

## IA — fundação + análise (Phase 2.1)

- [x] Migration `003_ai` applies automatically on server restart — the
      live DB's `schema_migrations` now has `001`, `002`, `003_ai` and
      the `claude_api_calls` + `ai_analyses` tables exist (verified this
      run).
- [x] With no `ANTHROPIC_API_KEY`: `GET /api/ai/status` → 200
      `configured:false`, `capUsdCents:400`; `POST /api/ai/analyses`
      → 503; a bad `kind` → 400; `GET /api/ai/analyses` → `[]`;
      `?limit=0` → 400; all → 401 without a session (e2e).
- [x] `loadDotEnv` — `KEY=VALUE`, `#` comments, quotes, no-override,
      missing-file no-op (3 unit tests). `loadConfig` maps the four AI
      env vars + defaults; `apiKey` is `null` when unset (2 unit tests).
- [x] `callClaude` — right URL/headers/body, parses text + usage, maps
      non-2xx → `ClaudeUpstreamError(status)`, network throw →
      `(null)`, `apiKey:null` → `ClaudeNotConfiguredError` with no fetch
      (4 unit tests). `estimateCostUsdCents` — `$3/$15` per Mtok,
      half-up, unknown model throws (2 unit tests).
- [x] `buildSnapshot` — 3-month income window, category sort, reserve
      balance, serialisable + < 8 KB on the seed fixture; empty-DB safe
      (2 unit tests).
- [x] `runAnalysis` — success writes one `ok` call row + one analysis
      row and returns the joined shape; upstream failure writes one
      `error` row and re-throws; month-to-date ≥ cap throws
      `BudgetExceededError` with no call. `listAnalyses` newest-first +
      cost join; `aiStatus` configured flag + dollar-quote rate (5 unit
      tests).
- [x] `Markdown` renderer — headings / bold / italic / ordered +
      unordered lists / inline code; literal `<script>` stays text, no
      HTML injection (2 unit tests).
- [x] `ConsultorIA` — buttons disabled + config note when
      `configured:false`; a preset click calls `runAiAnalysis(kind)` and
      renders the Markdown; a 429 shows the limit warning; history lists
      collapsed and expands (4 unit tests). `AnalisePage` renders the
      "Consultor IA" card (unit).
- [ ] In the browser: the Análise page shows a disabled "Consultor IA"
      card while no key is set. After putting `ANTHROPIC_API_KEY` in
      `server/.env` and restarting, a preset returns a Markdown answer,
      the "IA este mês" line moves, and the run appears in Histórico.

## Auto-categorização (Phase 2.2)

- [x] `matchRule` — first substring hit wins, case-insensitive;
      `addRule` trims/lowercases the keyword, rejects a blank keyword or
      an off-list category, dedupes an identical rule; `deleteRule`
      soft-deletes (4 unit tests). `CATEGORIES` is the agreed 11 (unit,
      both sides).
- [x] `claudeCategorize` — uses `cfg.categorizeModel`
      (`claude-haiku-4-5`), parses strict JSON, strips a ```json fence,
      degrades a bad/off-list/low-confidence reply to `{category:null,
      confidence:'low',keyword:null}`, propagates an HTTP error (4 unit
      tests). Haiku priced `$1/$5` per Mtok (unit).
- [x] `categorize` — a rule hit returns instantly with no ledger row and
      no fetch; no rule + no key → `none`; no rule + key + high-conf →
      category applied, one `ok` `endpoint='categorize'` ledger row, a
      new `category_rules` row learned; low-conf → uncategorized, nothing
      learned; monthly cap reached → no fetch; upstream error → `error`
      ledger row, `none`, no throw (6 unit tests).
- [x] `POST /api/expenses` with `category:""` — filled from a matching
      rule; left `""` when nothing matches and no key; one rule result
      applied to every installment row (e2e + integration).
- [x] `POST /api/expenses/categorize-pending` — sweeps `category=''`
      rows deduped by description, returns `{updated, stillPending,
      stoppedAtCap}`, stops at the cap (e2e + integration).
- [x] `GET/POST/DELETE /api/category-rules` — CRUD round-trip; 401 without
      a session; `POST` blank keyword or unknown category → 400 (e2e +
      integration).
- [x] `CategoryRulesSection` lists/adds/deletes rules and surfaces a 400;
      GastosPage defaults the category select to "Automático", submits a
      blank category, shows "— sem categoria" and a "Categorizar
      pendentes (n)" button (5 unit tests).
- [x] QA runs the isolated server from a scratch dir with
      `ANTHROPIC_API_KEY=""` so it never makes a real Claude call
      (verified — 2.1 no-key assertions still pass).
- [ ] In the browser: add an expense with "Automático" and a real
      merchant name → within ~2s it comes back categorized, a
      `category_rules` row appears, and the Análise "IA este mês" figure
      ticks up a fraction of a cent. The "Regras de categoria" section
      adds/deletes rules.

## Importação de extrato PDF (Phase 2.3)

- [x] `callClaude` passes a content-block array straight through as the
      user message content; the string form is unchanged (unit).
- [x] `inferType` maps Moradia/Alimentação/Transporte/Saúde/Educação to
      `essencial`, everything else (incl. blank) to `nao-essencial`
      (unit).
- [x] `extractStatement` — builds a `document` block
      (`media_type: application/pdf`, base64) + a text block, calls
      `claude-sonnet-5` with `max_tokens 4000`; parses the JSON array,
      strips a ```json fence, drops invalid rows with a warning, returns
      `[]` + a warning for a non-array reply; writes an `endpoint='import'`
      ok row (with a db) / error row on an upstream failure (then
      rethrows); `ClaudeNotConfiguredError` with no key and no fetch;
      `BudgetExceededError` when the db shows the cap is reached, no
      fetch (7 unit tests).
- [x] `POST /api/expenses/import-preview` — `503` with no key, `400` on
      an empty upload; a decoded PDF > 12 MB → `400`; `bodyLimit` raised
      to 20 MB on this route only (e2e + integration).
- [x] `POST /api/expenses/import-confirm` — one expense per row
      (`paymentMethod: 'Crédito'`, `installmentTotal: null` even for a
      "(3/12)" line), blank categories resolved via `categorize`,
      `{ created }`; a malformed row or an empty list → `400` (e2e +
      integration).
- [x] `StatementImportSection` — a picked PDF is read to base64 (the
      `data:` prefix stripped) and sent to `importPreviewStatement`; the
      review table renders one row per preview row; `payment`/`fee` and
      `duplicate` rows start unchecked; "Importar N selecionado(s)" sends
      only checked rows with their edited category; a 429 preview shows
      the limit warning; `warnings` render as a muted line (3 unit
      tests).
- [ ] In the browser: open "Importar extrato (PDF)" on the Gastos page,
      pick a real credit-card statement → within a few seconds a review
      table appears with the month's charges (payments/fees
      pre-unchecked); confirm a few → they land in the expense list
      categorized; a `claude_api_calls` row with `endpoint='import'`
      exists; the Análise "IA este mês" figure rises a few cents.

## Câmbio + contexto de mercado / Uso da IA (Phase 2.4)

- [x] `FUMARENDE_AI_WEB_SEARCH` (`off`/`false`/`0` → false, default on)
      and `FUMARENDE_AI_WEB_SEARCH_MAX` (default 3) parse into
      `config.ai` (unit).
- [x] `callClaude` includes a `tools` array in the body only when given;
      surfaces `usage.server_tool_use.web_search_requests` as
      `webSearchRequests` (0 default) (unit). `estimateCostUsdCents`
      adds 1¢ per search (unit). `webSearchTool(3)` shape (unit).
- [x] `runAnalysis(db, cfg, 'cambio', { webSearch: true })` — attaches
      the tool, uses the market-aware system prompt, tags the ledger row
      `endpoint='analysis:cambio+web'`, and bills the searches; with
      `cfg.webSearch=false` or a non-câmbio kind it runs data-only with
      no `tools` and `endpoint='analysis:${kind}'` (3 unit tests).
      `aiStatus` reports `webSearch`.
- [x] `aiUsage` — `monthToDateUsdCents` and `byEndpoint` are this-month
      ok-only (errors excluded), `byEndpoint` sorted by cost desc,
      `recent` is the last 20 by id regardless of status/month, rate
      falls back to `usdBrlFallbackRate` (2 unit tests).
- [x] `GET /api/ai/usage` → 200 shape (`byEndpoint`/`recent`/`capUsdCents`),
      401 without a session; `GET /api/ai/status` includes `webSearch`;
      `POST /api/ai/analyses { kind:'cambio', webSearch:true }` with no
      key → 503 (e2e + integration).
- [x] `ConsultorIA` shows the "com contexto de mercado" checkbox only
      when `status.webSearch`; checking it + running the câmbio preset
      calls `runAiAnalysis('cambio', true)`; other presets always pass
      `false` (2 unit tests).
- [x] `AiUsageSection` renders the month-to-date line, the by-kind
      breakdown (with labels), the collapsible last-calls log, and a
      soft error on fetch failure (3 unit tests). `AnalisePage` renders
      the "Uso da IA" heading (unit).
- [ ] In the browser (key configured): the câmbio checkbox is present;
      running "Converter dólares agora?" with it checked returns an
      answer that cites a current rate / source; the "Uso da IA" section
      shows a `Câmbio + web` row whose cost is a few cents above a
      data-only câmbio run; a `claude_api_calls` row with
      `endpoint='analysis:cambio+web'` exists.

## Design system foundation (Phase 2.5.1)

- [x] `ThemeContext` — defaults to `system` with no `data-theme`
      attribute, honours a stored `light`/`dark` and sets the attribute,
      `setTheme` persists to `localStorage['fumarende.theme']` and
      sets/clears the attribute, a tampered value falls back to
      `system`, `useTheme()` throws outside a provider (4 unit tests).
- [x] `theme.css` — the `[data-theme='dark']` and
      `prefers-color-scheme: dark` blocks declare the same
      custom-property names; the alias tokens (`--card`, `--bg2`,
      `--text2`, `--text3`, `--cyan`, `--coral`, `--amber`, `--sans`,
      `--mono`, `--radius`) stay defined so the not-yet-migrated pages
      render unchanged; the class vocabulary (`.btn*`, `.field*`,
      `.page-title`, `.section-title`, `.stack`, `.row`, `.table-scroll`,
      `.nav`) is present (parse test).
- [x] `NavShell` — a Sistema/Claro/Escuro control
      (`role="group" aria-label="Tema"`) sets and persists the theme;
      the `Menu` hamburger toggles `.nav--open` and a nav-link click
      closes it; the `Mês` select still works (3 unit tests).
- [x] `LoginPage` and `DashboardPage` migrated to the class vocabulary;
      their existing text/role tests stay green.
- [x] Fonts are bundled — `npm run build` emits Space Grotesk +
      JetBrains Mono `.woff2` into `dist/assets`; no `fonts.googleapis.com`.
- [ ] Browser: the light/dark toggle recolours the whole app and the
      choice survives a reload; "Sistema" follows the OS appearance;
      below ~800px the sidebar is a top bar + working hamburger and wide
      content scrolls; dark mode looks the same as before this slice;
      the 17 un-migrated pages render correctly in both themes.

## States & feedback (Phase 2.5.3)

- [x] `useResource` — loading -> resolved / rejected(message) / reload
      re-runs / no setState after unmount (4 unit tests).
- [x] `AsyncBoundary` — skeleton while loading, error card + working
      Recarregar on failure, children when resolved (3 unit tests).
      `Skeleton` renders N blocks and is `aria-hidden` (unit).
      `EmptyState` shows message + optional action (unit).
- [x] `ToastContext` — `toast()` renders in a `role="status"` region,
      stacks a second, the dismiss button removes one, auto-dismiss
      after 3.5s, `useToast` throws outside a provider (3 unit tests).
- [x] `<Field>` — label association, inline `role="alert"` error, hint
      (unit). `useFormErrors` set/clear/clearAll/hasErrors (unit).
- [x] All 11 pages load through `useResource` + `AsyncBoundary`; their
      existing behaviour tests pass with a `ToastProvider` wrap and the
      first assertion switched to `findBy`. `DashboardPage` also has a
      rejected-load -> Recarregar -> re-fetch test.
- [x] The 5 validated forms (Receitas, Câmbio, Gastos, Reserva,
      Histórico Dólar) validate per-field on blur (inline
      `field-error` + `aria-invalid`) and show a success toast on save;
      action failures are toasts, not inline strings (three-way split).
- [x] PDF import shows an indeterminate bar + elapsed timer + Cancelar;
      Cancelar aborts the client fetch (AbortController) and returns to
      idle with "Leitura cancelada." (unit). `importPreviewStatement`
      gained an optional `signal` arg — the only api.ts change.
- [x] All new animations (skeleton pulse, toast slide-in, progress
      slide) are disabled under `prefers-reduced-motion`.
- [ ] Browser: every page shows pulsing skeleton blocks then content;
      stop the server and reload -> an error card with a working
      Recarregar; submit a form with a bad value -> inline message under
      the field; a good submit -> a toast bottom-centre; the PDF import
      shows a sliding bar + seconds counter + Cancelar that returns to
      idle.

## Styling convention (Phase 2.5.2)

- [x] `<PageHeader>` — `title` renders an `<h1>`, `subtitle` renders
      only when passed, an `actions` node renders when passed (3 unit
      tests).
- [x] `theme.css` gains `.page`, `.page-header*`, `.form-grid`,
      `.list-row`, `.data-list`, `.data-table`, `.chart-svg`; the
      class-vocabulary parse test asserts all seven are present.
      `.page-title` no longer sets its own `margin-bottom` — vertical
      rhythm now comes from `.page` / `.page-header` (LoginPage adds
      `stack` to its card to compensate).
- [x] All 11 pages wrap their body in `.page` and their heading in
      `<PageHeader>`; forms use `.card form-grid` + `.field` /
      `.field-label`; list/ledger rows use `.list-row`; the Histórico
      Dólar / AI-usage / PDF-import tables use `.table-scroll` +
      `.data-table`; label/value blocks use `.data-list`; inline SVG
      charts use `.chart-svg`.
- [x] The 8 shared components (ConsultorIA, AiUsageSection,
      BarBreakdown, TargetCard, TargetSection, FixedExpensesSection,
      CategoryRulesSection, StatementImportSection) are on the same
      vocabulary; `BarBreakdown` reuses `.dash-goal-track` /
      `.dash-goal-fill`.
- [x] Every page/component test passes unchanged (assertions are on
      text/role/label, not style) — full frontend suite 161 green,
      `tsc --noEmit` clean, `npm run build` exit 0, server 269 green,
      e2e 133/133.
- [x] `grep -rn "style={{" frontend/src` returns only: computed values
      (goal-bar / cut-slider width, conditional colour), layout
      constraints (`flex:1`, `width:40/110/100%`, `whiteSpace:nowrap`,
      `display:block` on file inputs), deliberate token spacing
      (`marginTop: var(--space-*)` where a wrapper would be more
      disruptive), and the ~9 identical link-style Excluir/Editar
      buttons (`background:none; border:none; …`) — deferred to a
      follow-up `.link-btn` class, out of scope for this slice.
- [ ] Browser: every page's content and spacing matches the pre-slice
      look within the noted consistency shifts (section headings
      15→16px, card gaps →24px, list-row padding 10→12px, helper text
      →11px); Câmbio / Histórico Dólar subtitles render under the
      title; light + dark both intact; the import + AI-usage tables
      share the `.data-table` look.
