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

**Phase 2 in progress** — Claude API integration, split into four
slices:

1. **Foundation + on-demand analysis** ✅ — a raw-`fetch` Claude client,
   a `claude_api_calls` / `ai_analyses` ledger, a soft monthly spend
   cap, and three preset read-only analyses in a "Consultor IA" card on
   the Análise page.
2. **Auto-categorization** ✅ — a free keyword-rule pass then a Haiku
   fallback for unknown merchants (which learns a new rule), on expense
   create and via a "Categorizar pendentes" sweep; a "Regras de
   categoria" management section on the Gastos page.
3. PDF statement import — next.
4. Web-search-backed macro context for the câmbio analysis.

Set `ANTHROPIC_API_KEY` in `server/.env` to enable the AI features;
without a key every AI route returns a clean "not configured" response
and categorization falls back to rules only.

Design specs and implementation plans live under `docs/superpowers/`.

## Repo layout

Populated as implementation starts. `docs/superpowers/` holds design specs
and implementation plans, following the
[Superpowers](https://github.com/obra/superpowers) brainstorm → spec →
plan → implement workflow.
