# Accessibility Audit Implementation Plan (Phase 2.5.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the WCAG 2.1 AA gaps found in the audit — skip link,
landmarks, visible focus on every control, disclosure semantics,
`aria-describedby` on form errors, data-table semantics, light-theme
contrast, and route-change focus + title — with standard fixes and no
new dependency.

**Architecture:** Three utility classes (`.skip-link`, `.sr-only`,
`.link-btn`) and a bare `:focus-visible` rule go into `theme.css`; five
light tokens (plus dark `--text-subtle`) move darker to clear 4.5:1, and
a computed contrast test locks that in. `NavShell` gets the skip link +
`<main id tabIndex>` + labelled `<nav>` + hamburger state. A tiny
`RouteEffects` component in `App.tsx` sets `document.title` and focuses
`#main` on navigation. The rest is per-file ARIA additions and swapping
~11 inline link-button styles for `.link-btn`.

**Tech Stack:** React 18, React Router 6, Vite 6, Vitest
(+ `@testing-library/react`), plain CSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-01-accessibility-audit-design.md`

## Global Constraints

- **Frontend only.** No new dependency (no `jest-axe`), no server /
  e2e change, no behaviour change beyond the a11y affordances, no
  layout/type/spacing change. The only colour change is six token
  values moving darker to clear WCAG AA 4.5:1.
- **`prefers-reduced-motion`** handling (2.5.1/2.5.3) and the toast
  live region (2.5.3) are correct — do not touch them.
- **Existing tests assert on text / role / label.** The `.link-btn`
  swap and ARIA additions do not change any queried text or role —
  every existing suite must pass unchanged. `getByRole('button', {
  name: 'Excluir …' })` still resolves (the `aria-label`s stay).
- **Dark `--text-subtle` must be edited in two places** — the
  `:root[data-theme='dark']` block and the `@media
  (prefers-color-scheme: dark) :root:not([data-theme='light'])` block —
  to the same value. `theme.test.ts` asserts the two blocks declare the
  same property *names* (unchanged; only a value moves).
- Frontend tests run from `frontend/`. Typecheck: `./node_modules/.bin/tsc
  -p tsconfig.json --noEmit` from `frontend/`.
- Branch `accessibility-audit` off `main`; the finishing skill merges
  it. One commit per task.

## Shared token values

Light `:root`:

| Token | Was → New |
|---|---|
| `--accent` | `#0a8a78` → `#04756a` |
| `--danger` | `#d63a58` → `#c22a48` |
| `--warning` | `#b3730f` → `#875a0b` |
| `--text-subtle` | `#6b7280` → `#5c6370` |
| `--success` | `#1a9463` → `#0f7047` |

Dark (both blocks): `--text-subtle` `#565d6e` → `#7b8494`.

---

## Task 1: CSS utilities + focus rule

**Files:**
- Modify: `frontend/src/theme.css`
- Modify: `frontend/src/theme.test.ts`

- [ ] **Step 1: Replace the focus rule**

In `theme.css`, the current block is:

```css
/* ---- focus ---- */
.btn:focus-visible,
.field-input:focus-visible,
select:focus-visible,
a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

Replace with:

```css
/* ---- focus ---- */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 2: Append the a11y utilities**

At the end of `theme.css`:

```css
/* ---- a11y utilities (2.5.4) ---- */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.skip-link {
  position: absolute;
  left: var(--space-3);
  top: var(--space-3);
  z-index: 200;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text);
  text-decoration: none;
  transform: translateY(-150%);
}
.skip-link:focus {
  transform: translateY(0);
}
.link-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--text-subtle);
  cursor: pointer;
}
.link-btn:hover {
  color: var(--text);
  text-decoration: underline;
}
```

- [ ] **Step 3: Extend the vocabulary test**

In `theme.test.ts`, the "defines the class vocabulary" test iterates an
array of selector strings. Add `'.skip-link'`, `'.sr-only'`,
`'.link-btn'` to that array.

- [ ] **Step 4: Run + build**

Run: `cd frontend && npx vitest run src/theme.test.tsx src/theme.test.ts`
Expected: PASS.
Run: `cd frontend && npm run build` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theme.css frontend/src/theme.test.ts
git commit -m "a11y: .sr-only / .skip-link / .link-btn utilities; broaden :focus-visible to all controls

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Contrast retune + computed test

**Files:**
- Modify: `frontend/src/theme.css`
- Modify: `frontend/src/theme.test.ts`

- [ ] **Step 1: Retune the light `:root` tokens**

In the `:root { … /* ---- LIGHT semantic tokens ---- */ … }` block:

```css
  --accent: #04756a;      /* was #0a8a78 */
  --danger: #c22a48;      /* was #d63a58 */
  --warning: #875a0b;     /* was #b3730f */
  --text-subtle: #5c6370; /* was #6b7280 */
  --success: #0f7047;     /* was #1a9463 */
```

Leave `--text`, `--text-muted`, `--accent-contrast`, `--violet`, and all
`--bg*` / `--border*` unchanged.

- [ ] **Step 2: Retune dark `--text-subtle` in BOTH blocks**

In `:root[data-theme='dark'] { … }`:

```css
  --text-subtle: #7b8494; /* was #565d6e */
```

In `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { … } }`:

```css
    --text-subtle: #7b8494; /* was #565d6e — KEEP IN SYNC with the block above */
```

- [ ] **Step 2b: Run the existing theme test (parity must still hold)**

Run: `cd frontend && npx vitest run src/theme.test.ts`
Expected: PASS — the two dark blocks still declare the same property
names.

- [ ] **Step 3: Write the failing computed-contrast test**

Add to `theme.test.ts`:

```ts
function relLum(hex: string): number {
  const c = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(c.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function tokenValue(block: string, name: string): string {
  const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,8})`).exec(block);
  if (!m) throw new Error(`token not found: ${name}`);
  return m[1];
}

describe('theme.css contrast (WCAG AA)', () => {
  const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
  const darkBlock = css.slice(
    css.indexOf("[data-theme='dark'] {"),
    css.indexOf('\n}', css.indexOf("[data-theme='dark'] {")),
  );

  it('light foreground tokens clear 4.5:1 on card (#fff) and page bg (#f7f6f3)', () => {
    for (const name of ['--accent', '--danger', '--warning', '--text-subtle', '--success']) {
      const hex = tokenValue(rootBlock, name);
      expect(ratio(hex, '#ffffff'), `${name} on #fff`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(hex, '#f7f6f3'), `${name} on #f7f6f3`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark text tokens clear 4.5:1 on the dark card (#101016)', () => {
    for (const name of ['--text-subtle', '--text-muted']) {
      const hex = tokenValue(darkBlock, name);
      expect(ratio(hex, '#101016'), `${name} on #101016`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
```

(`css` is the already-parsed, comment-stripped stylesheet string at the
top of `theme.test.ts`. Adjust the two `slice` boundaries if the file's
brace layout differs — the intent is "the `:root` light block" and "the
`[data-theme='dark']` block".)

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/theme.test.ts`
Expected: PASS (both new tests green — Step 1/2 already made them true).

- [ ] **Step 5: Full frontend suite + build**

Run: `cd frontend && npm test && npm run build`
Expected: green, exit 0 (no component test reads token hex values).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/theme.css frontend/src/theme.test.ts
git commit -m "a11y: retune light --accent/--danger/--warning/--text-subtle/--success + dark --text-subtle for AA; lock with a computed contrast test

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Skip link + landmarks (NavShell)

**Files:**
- Modify: `frontend/src/components/NavShell.tsx`
- Modify: `frontend/src/components/NavShell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `NavShell.test.tsx` (match the file's existing render helper —
it wraps `<NavShell />` in a `MemoryRouter` with a couple of routes):

```tsx
it('renders a skip link to #main as the first focusable element', () => {
  renderNav(); // existing helper
  const skip = screen.getByRole('link', { name: 'Pular para o conteúdo' });
  expect(skip).toHaveAttribute('href', '#main');
});

it('the hamburger reports its expanded state', () => {
  renderNav();
  const btn = screen.getByRole('button', { name: 'Menu' });
  expect(btn).toHaveAttribute('aria-expanded', 'false');
  expect(btn).toHaveAttribute('aria-controls', 'nav-list');
  fireEvent.click(btn);
  expect(btn).toHaveAttribute('aria-expanded', 'true');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/NavShell.test.tsx`
Expected: FAIL — no skip link, no `aria-expanded`.

- [ ] **Step 3: Implement**

In `NavShell.tsx`:

- First child of `<div className="app">`, before `<nav>`:
  ```tsx
  <a href="#main" className="skip-link">Pular para o conteúdo</a>
  ```
- `<nav aria-label="Navegação principal" className={`nav${menuOpen ? ' nav--open' : ''}`}>`
- The hamburger button:
  ```tsx
  <button
    type="button"
    className="btn btn-sm btn-ghost nav__hamburger"
    aria-label="Menu"
    aria-expanded={menuOpen}
    aria-controls="nav-list"
    onClick={() => setMenuOpen((v) => !v)}
  >
    ☰
  </button>
  ```
- `<div className="nav__list" id="nav-list">`
- `<main className="main" id="main" tabIndex={-1}>`

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run src/components/NavShell.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/NavShell.tsx frontend/src/components/NavShell.test.tsx
git commit -m "a11y: skip link, labelled <nav>, <main id tabIndex>, hamburger aria-expanded/-controls

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Route change — focus + title (App.tsx)

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `App.test.tsx` (it already renders `<App />` and navigates —
reuse that setup):

```tsx
it('sets the document title and focuses main on navigation', async () => {
  // …existing auth + render-App setup, land on Dashboard…
  fireEvent.click(await screen.findByRole('link', { name: 'Receitas' }));
  await waitFor(() => expect(document.title).toBe('Receitas · fumarende'));
  const main = document.getElementById('main');
  expect(main).not.toBeNull();
  expect(main === document.activeElement || main?.contains(document.activeElement)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/App.test.tsx`
Expected: FAIL — title stays `fumarende`, focus unchanged.

- [ ] **Step 3: Implement**

In `App.tsx`, add imports `useEffect`, `useRef` from `react` and
`useLocation` from `react-router-dom`, then:

```tsx
const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/receitas': 'Receitas',
  '/cambio': 'Câmbio',
  '/gastos': 'Gastos',
  '/parcelas': 'Parcelas',
  '/reserva': 'Reserva',
  '/metas': 'Metas',
  '/projetos': 'Projetos Especiais',
  '/analise': 'Análise',
  '/historico-dolar': 'Histórico Dólar',
  '/backup': 'Backup & Dados',
  '/login': 'Entrar',
};

function RouteEffects() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    const name = PAGE_TITLES[pathname];
    document.title = name ? `${name} · fumarende` : 'fumarende';
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('main')?.focus();
  }, [pathname]);
  return null;
}
```

Render `<RouteEffects />` just inside `<BrowserRouter>`, before
`<Routes>`:

```tsx
    <BrowserRouter>
      <RouteEffects />
      <Routes>
        …
```

- [ ] **Step 4: Run to verify it passes + full suite**

Run: `cd frontend && npx vitest run src/App.test.tsx && npm test`
Expected: PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "a11y: on route change, set document.title and move focus to <main>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `.link-btn` rollout

**Files:**
- Modify: `frontend/src/pages/{Receitas,Cambio,Gastos,Parcelas,Reserva,HistoricoDolar}Page.tsx`
- Modify: `frontend/src/components/{FixedExpensesSection,CategoryRulesSection,TargetCard,ConsultorIA,AiUsageSection}.tsx`

**Recipe:** every `<button>` whose `style` prop is the inline object
`{ background: 'none', border: 'none', padding: 0, fontSize: 12.5,
color: 'var(--text3)' | 'var(--text2)', cursor: 'pointer' }` — delete
the `style` prop and add `className="link-btn"` (merge if the button
already has a `className`). Keep every other prop (`type`, `onClick`,
`aria-label`, `key`).

- [ ] **Step 1: Pages** — the row "Excluir" buttons in `ReceitasPage`,
  `CambioPage`, `GastosPage`, `ParcelasPage`, `ReservaPage`,
  `HistoricoDolarPage`.
- [ ] **Step 2: `FixedExpensesSection` + `CategoryRulesSection`** — the
  "Excluir" buttons.
- [ ] **Step 3: `TargetCard`** — delete the module-level
  `const ghostBtn = { … }` and put `className="link-btn"` on all three
  buttons (Adicionar / Editar / Excluir).
- [ ] **Step 4: `ConsultorIA` + `AiUsageSection`** — the disclosure
  toggle buttons (they carried `color: 'var(--text2)'`): same swap →
  `className="link-btn"`.
- [ ] **Step 5: Run every touched suite + tsc**

Run: `cd frontend && npx vitest run src/pages/ReceitasPage.test.tsx src/pages/CambioPage.test.tsx src/pages/GastosPage.test.tsx src/pages/ParcelasPage.test.tsx src/pages/ReservaPage.test.tsx src/pages/HistoricoDolarPage.test.tsx src/components/FixedExpensesSection.test.tsx src/components/CategoryRulesSection.test.tsx src/components/TargetCard.test.tsx src/components/TargetSection.test.tsx src/components/ConsultorIA.test.tsx src/components/AiUsageSection.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Grep-verify**

Run: `cd frontend && grep -rn "background: 'none'" src/ | grep -v test`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/ReceitasPage.tsx frontend/src/pages/CambioPage.tsx frontend/src/pages/GastosPage.tsx frontend/src/pages/ParcelasPage.tsx frontend/src/pages/ReservaPage.tsx frontend/src/pages/HistoricoDolarPage.tsx frontend/src/components/FixedExpensesSection.tsx frontend/src/components/CategoryRulesSection.tsx frontend/src/components/TargetCard.tsx frontend/src/components/ConsultorIA.tsx frontend/src/components/AiUsageSection.tsx
git commit -m "a11y: replace 11 inline link-style buttons with .link-btn (focusable + hover affordance)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Disclosure semantics

**Files:**
- Modify: `frontend/src/components/ConsultorIA.tsx`
- Modify: `frontend/src/components/AiUsageSection.tsx`
- Modify: `frontend/src/components/ConsultorIA.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `ConsultorIA.test.tsx` (its setup already mocks `getAiStatus` /
`listAiAnalyses` and renders `<ConsultorIA />` inside `ToastProvider` via
the shared `render`):

```tsx
it('the history toggle exposes its expanded state and controls the region', async () => {
  // …existing setup that yields a non-empty history…
  const toggle = await screen.findByRole('button', { name: /Histórico/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveAttribute('aria-controls', 'consultor-history');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(document.getElementById('consultor-history')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/ConsultorIA.test.tsx`
Expected: FAIL — no `aria-expanded`.

- [ ] **Step 3: Implement**

`ConsultorIA.tsx` — the history toggle button:
```tsx
<button
  type="button"
  className="link-btn"
  aria-expanded={showHistory}
  aria-controls="consultor-history"
  onClick={() => setShowHistory((v) => !v)}
>
  {showHistory ? '▾' : '▸'} Histórico ({history.length})
</button>
{showHistory && (
  <div id="consultor-history" className="stack-sm" style={{ marginTop: 'var(--space-3)' }}>
    …
  </div>
)}
```

`AiUsageSection.tsx` — the "Últimas chamadas" toggle: same shape,
`aria-controls="ai-usage-log"` on the button, `id="ai-usage-log"` on the
`{showLog && (<div …>)}` wrapper.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/ConsultorIA.test.tsx src/components/AiUsageSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ConsultorIA.tsx frontend/src/components/AiUsageSection.tsx frontend/src/components/ConsultorIA.test.tsx
git commit -m "a11y: aria-expanded / aria-controls on the ConsultorIA + AiUsage disclosure toggles

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Form error association

**Files:**
- Modify: `frontend/src/components/Field.tsx`
- Modify: `frontend/src/components/Field.test.tsx`
- Modify: `frontend/src/pages/{Receitas,Cambio,Gastos,Reserva,HistoricoDolar}Page.tsx`
- Modify: `frontend/src/pages/ReceitasPage.test.tsx`

**Id convention:** for a control with `id="X"`, its error span is
`id="X-error"` and the control carries
`aria-describedby={<error present> ? 'X-error' : undefined}`.

- [ ] **Step 1: Failing tests**

`Field.test.tsx` — add:
```tsx
it('gives the error span an id derived from htmlFor', () => {
  render(
    <Field label="Valor" htmlFor="v" error="Valor inválido">
      <input id="v" />
    </Field>,
  );
  expect(screen.getByRole('alert')).toHaveAttribute('id', 'v-error');
});
```

`ReceitasPage.test.tsx` — extend the existing "shows an inline field
error … on blur" test with:
```tsx
  expect(amount).toHaveAttribute('aria-describedby', 'rec-amount-error');
  expect(screen.getByRole('alert')).toHaveAttribute('id', 'rec-amount-error');
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/components/Field.test.tsx src/pages/ReceitasPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `Field.tsx`**

```tsx
{error && (
  <span className="field-error" role="alert" id={`${htmlFor}-error`}>
    {error}
  </span>
)}
```

- [ ] **Step 4: `ReceitasPage.tsx`** — on the two `<Field>`-wrapped
  inputs:
```tsx
<input
  id="rec-amount"
  …
  aria-invalid={!!f.errors.amount}
  aria-describedby={f.errors.amount ? 'rec-amount-error' : undefined}
  …
/>
```
and the same for `rec-amount-usd` → `rec-amount-usd-error`.

- [ ] **Step 5: The four inline-span forms** — for each validated input,
  give the `<span className="field-error">` `id="<input-id>-error"` and
  the input `aria-describedby={f.errors.<key> ? '<input-id>-error' : undefined}`:
  - `CambioPage`: `cambio-amount-usd` / `cambio-rate` / `cambio-ptax`;
    the IOF + Tarifa inputs both point at `cambio-fees-error` (the span
    already renders once, after `cambio-bank-fee` — give it that id).
  - `GastosPage`: `gasto-amount` / `gasto-installments`.
  - `ReservaPage`: `dep-amount` / `wd-amount`.
  - `HistoricoDolarPage`: `dol-rate` / `dol-salary`.

- [ ] **Step 6: Run to verify + touched suites + tsc**

Run: `cd frontend && npx vitest run src/components/Field.test.tsx src/pages/ReceitasPage.test.tsx src/pages/CambioPage.test.tsx src/pages/GastosPage.test.tsx src/pages/ReservaPage.test.tsx src/pages/HistoricoDolarPage.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Field.tsx frontend/src/components/Field.test.tsx frontend/src/pages/ReceitasPage.tsx frontend/src/pages/ReceitasPage.test.tsx frontend/src/pages/CambioPage.tsx frontend/src/pages/GastosPage.tsx frontend/src/pages/ReservaPage.tsx frontend/src/pages/HistoricoDolarPage.tsx
git commit -m "a11y: link field errors to their inputs with aria-describedby (id = <field>-error)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Table semantics + slider value text

**Files:**
- Modify: `frontend/src/pages/HistoricoDolarPage.tsx`
- Modify: `frontend/src/components/StatementImportSection.tsx`
- Modify: `frontend/src/pages/AnalisePage.tsx`
- Modify: `frontend/src/pages/HistoricoDolarPage.test.tsx`

- [ ] **Step 1: Failing test**

`HistoricoDolarPage.test.tsx` — add:
```tsx
it('the quotes table has column-scoped headers', async () => {
  vi.spyOn(api, 'listDollarQuotes').mockResolvedValue([
    { month: '2026-06', rate: 5.12, salaryUsdCents: 500_000 },
  ]);
  render(<HistoricoDolarPage />);
  const header = await screen.findByRole('columnheader', { name: 'Mês' });
  expect(header).toHaveAttribute('scope', 'col');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/HistoricoDolarPage.test.tsx`
Expected: FAIL — no `scope`.

- [ ] **Step 3: `HistoricoDolarPage.tsx` table**

- `<table className="data-table">` → add as its first child:
  `<caption className="sr-only">Cotações mensais do dólar</caption>`
- every text `<th>` → `<th scope="col">…</th>`
- the empty trailing `<th />` → `<th scope="col"><span className="sr-only">Ações</span></th>`

- [ ] **Step 4: `StatementImportSection.tsx` review table**

- first child of `<table className="data-table">`:
  `<caption className="sr-only">Lançamentos do extrato para revisão</caption>`
- text `<th>`s (Data / Descrição / Valor / Categoria / Tipo / Linha) →
  `scope="col"`
- the empty leading `<th></th>` (checkbox column) →
  `<th scope="col"><span className="sr-only">Incluir</span></th>`

- [ ] **Step 5: `AnalisePage.tsx` sliders**

On each cut `<input type="range" …>` add:
```tsx
aria-valuetext={`${cuts[c.category] ?? 0}%`}
```

- [ ] **Step 6: Run to verify + touched suites + tsc**

Run: `cd frontend && npx vitest run src/pages/HistoricoDolarPage.test.tsx src/components/StatementImportSection.test.tsx src/pages/AnalisePage.test.tsx`
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/HistoricoDolarPage.tsx frontend/src/pages/HistoricoDolarPage.test.tsx frontend/src/components/StatementImportSection.tsx frontend/src/pages/AnalisePage.tsx
git commit -m "a11y: scope=col + sr-only captions on data tables; aria-valuetext on the cut sliders

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Sweep, build, smoke, docs

**Files:** `docs/qa-checklist.md`, `README.md`.

- [ ] **Step 1: Full sweeps**

Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm run build` — green, exit 0.
Run: `cd server && npm test` — unchanged green.
Run: `bash scripts/qa-e2e.sh` — unchanged, `0 failed`.
Run: `cd frontend && grep -rn "background: 'none'" src/ | grep -v test` — no output.

- [ ] **Step 2: Restart live server + browser smoke**

```bash
cd frontend && npm run build
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1.5
curl -s -o /dev/null -w 'home: %{http_code}\n' http://localhost:4173/
```

Manual: Tab from a cold load → first stop is "Pular para o conteúdo",
Enter moves focus into the page; every button / link / checkbox /
slider / file input shows the accent focus ring; the "Histórico" /
"Últimas chamadas" toggles announce expanded/collapsed (VoiceOver);
navigating pages updates the tab title and moves focus to `<main>`;
light-theme primary buttons, error text, and `.subtle` captions read
clearly on both card and page backgrounds; dark theme unchanged bar
slightly lighter `.subtle` text.

- [ ] **Step 3: Docs**

`docs/qa-checklist.md` — bump the frontend test count; add a
`## Accessibility (Phase 2.5.4)` section:

```markdown
- [x] `.skip-link` / `.sr-only` / `.link-btn` present (vocab parse
      test); `:focus-visible` is a bare rule so every focusable control
      gets the accent outline.
- [x] Computed contrast test — light `--accent` / `--danger` /
      `--warning` / `--text-subtle` / `--success` clear 4.5:1 on `#fff`
      and `#f7f6f3`; dark `--text-subtle` / `--text-muted` clear 4.5:1
      on `#101016`.
- [x] Skip link targets `#main`; `<nav aria-label>`; `<main id="main"
      tabIndex={-1}>`; hamburger `aria-expanded` toggles and
      `aria-controls="nav-list"` (NavShell unit tests).
- [x] On navigation `document.title` becomes `"<Page> · fumarende"` and
      focus moves to `<main>` (App unit test).
- [x] The 11 inline link-style buttons are now `.link-btn` — focusable,
      hover-underlined; `grep "background: 'none'"` is clean.
- [x] ConsultorIA "Histórico" + AiUsage "Últimas chamadas" toggles
      carry `aria-expanded` + `aria-controls` (unit test).
- [x] Field errors: the alert span is `id="<field>-error"` and its
      input has `aria-describedby` to match while the error shows
      (Field + ReceitasPage unit tests).
- [x] `.data-table` headers are `scope="col"`; the dólar + import
      tables have an `sr-only` `<caption>`; cut sliders have
      `aria-valuetext` (unit test on the dólar table).
- [ ] Browser / VoiceOver: skip link works; focus ring on every
      control; disclosure toggles announce state; route change is
      announced; light + dark both legible.
```

`README.md` — under Phase 2.5, mark 2.5.4 done; 2.5.5 (dashboard /
análise grid pass) is next.

- [ ] **Step 4: Commit**

```bash
git add docs/qa-checklist.md README.md
git commit -m "Accessibility audit: docs + checklist"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| 1. `.sr-only` / `.skip-link` / `.link-btn` + bare `:focus-visible` | 1 |
| 2. light-token contrast retune (5 tokens) | 2 |
| 3. dark `--text-subtle` retune (both blocks) | 2 |
| 4. `theme.test.ts` vocab += 3 + computed-contrast test | 1 (vocab), 2 (contrast) |
| 5. skip link, `<nav>` label, `<main id tabIndex>`, hamburger state | 3 |
| 6. `.link-btn` rollout (11 sites, drop `ghostBtn`) | 5 |
| 7. disclosure `aria-expanded` / `aria-controls` / region id | 6 |
| 8. form error `id` convention + `aria-describedby` | 7 |
| 9. `scope="col"` + `sr-only` caption on the 2 real tables | 8 |
| 10. slider `aria-valuetext` | 8 |
| 11. `RouteEffects` — `document.title` + focus `#main` | 4 |
| verification / docs | 9 |

**Placeholder scan:** no `TODO`/`TBD`. Tasks 1–4 and 6–8 give complete
code; Task 5 is a single explicit find/replace recipe applied to a
named list of 11 sites. Every hex value, id string, and ARIA attribute
is spelled out.

**Type consistency:**
- `RouteEffects` / `PAGE_TITLES` (Task 4) — self-contained in `App.tsx`;
  `PAGE_TITLES` keys are the exact route paths from the existing
  `<Route path=…>` list.
- Error-id convention `${htmlFor}-error` (Task 7) is used identically in
  `Field.tsx`, `ReceitasPage.tsx`, and the four inline-span forms, and
  is what the `Field.test` / `ReceitasPage.test` assertions expect
  (`'v-error'`, `'rec-amount-error'`).
- `aria-controls` targets: `nav-list` (Task 3 button ↔ Task 3 div),
  `consultor-history` (Task 6 button ↔ Task 6 div), `ai-usage-log`
  (Task 6 button ↔ Task 6 div) — each id defined in the same task that
  references it.
- `.link-btn` (Task 1 CSS) is applied by Task 5 (11 sites) and Task 6
  (the 2 toggles, which Task 5 already converts — Task 6 only adds the
  ARIA attrs on top).
- No new exported symbol crosses a file boundary.

**Ordering note:** Task 5 converts the two disclosure toggles to
`.link-btn`; Task 6 then adds `aria-expanded` / `aria-controls` to those
same buttons. If executed out of order, Task 6's edit still applies
cleanly (it targets the button by its JSX, not its class) — but the
in-order path is cleaner.
