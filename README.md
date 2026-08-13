# fumarende

A personal finance web app: income (USD, paid remotely), monthly câmbio
(USD→BRL) conversion tracking, BRL credit card spending, savings, an
emergency fund, goals, and special projects — run as a persistent local
server reachable by URL from any device on the owner's home network.

## Status: design phase

This is a fresh rewrite of an earlier prototype ("Stacks"). No
implementation yet — see the design spec:

[`docs/superpowers/specs/2026-08-13-fumarende-phase1-design.md`](docs/superpowers/specs/2026-08-13-fumarende-phase1-design.md)

Phase 1 targets full feature parity with the prototype (income, expenses/
installments, câmbio contracts, savings/emergency fund, goals, special
projects, soft monthly close) on a Node/TypeScript server with a React
frontend, no AI features yet. Phase 2 adds Claude API integration
(statement import, categorization, on-demand financial analysis).

## Repo layout

Populated as implementation starts. `docs/superpowers/` holds design specs
and implementation plans, following the
[Superpowers](https://github.com/obra/superpowers) brainstorm → spec →
plan → implement workflow.
