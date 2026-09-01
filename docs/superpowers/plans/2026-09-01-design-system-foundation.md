# Design System Foundation Implementation Plan (Phase 2.5.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the intended fonts, expand `theme.css` into a
light/dark token system with a persisted toggle and a reusable class
vocabulary, make the nav responsive, and migrate `NavShell` +
`LoginPage` + `DashboardPage` to the new classes as a proof.

**Architecture:** `@fontsource/*` packages bundle the fonts (Vite
inlines them — no runtime dep, no network). `ThemeContext` mirrors
`MonthContext`: `'system' | 'light' | 'dark'` → `localStorage` →
`data-theme` on `<html>`; a pre-paint `<script>` in `index.html` avoids
a flash. `theme.css` grows from 69 to ~220 lines: scales + a light
`:root` + a dark `[data-theme='dark']` / `prefers-color-scheme` block +
old names kept as aliases + `.btn*` / `.field*` / layout / `.table-scroll`
classes. `NavShell` gets the toggle and a `<800px` top-bar + hamburger
drawer. Only three files lose their inline styles this slice.

**Tech Stack:** React 18, React Router 6, Vite 6, Vitest
(+ `@testing-library/react`), plain CSS custom properties. Two new
build-time asset deps (`@fontsource/space-grotesk`,
`@fontsource/jetbrains-mono`).

**Spec:** `docs/superpowers/specs/2026-09-01-design-system-foundation-design.md`

## Global Constraints

- **Frontend only.** No server change, no API change, no e2e change.
- **The other 17 files are NOT touched.** They keep their inline
  styles; the alias custom properties (`--card`, `--text2`, `--text3`,
  `--cyan`, `--coral`, `--amber`, `--sans`, `--mono`, `--radius`) must
  stay defined so those files render pixel-identically in **both**
  themes.
- **No redesign.** Dark mode after this slice must look like dark mode
  before it (systematized, not restyled). The light palette is derived,
  not a new identity.
- **No CSS framework, no CSS-in-JS.** One `theme.css`.
- `ThemeContext` storage access is `try/catch`-guarded; an
  unknown/tampered value falls back to `'system'`; `useTheme()` outside
  a provider throws.
- The three migrated files keep only genuinely dynamic inline styles
  (progress-bar `width`, SVG polyline geometry). Their existing tests
  assert on text/roles and must stay green.
- TDD where a test can lead (`ThemeContext`, `theme.test.ts`,
  `NavShell` toggle/hamburger); the file migrations are green-keeping
  refactors. Frontend tests from `frontend/`. Branch `design-foundation`
  off `main`; the finishing skill merges it. One commit per task.

---

## Task 1: Fonts + `ThemeContext` + pre-paint script + App wiring

**Files:**
- Modify: `frontend/package.json` (+ `package-lock.json`)
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/index.html`
- Create: `frontend/src/context/ThemeContext.tsx` + `.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  type ThemeChoice = 'system' | 'light' | 'dark';
  interface ThemeContextValue { theme: ThemeChoice; setTheme: (t: ThemeChoice) => void }
  function ThemeProvider({ children }: { children: ReactNode }): JSX.Element;
  function useTheme(): ThemeContextValue;   // throws outside a provider
  ```
  `STORAGE_KEY = 'fumarende.theme'`. Setting a choice puts `data-theme`
  = `'light'` / `'dark'` on `document.documentElement`, or removes it
  for `'system'`.

- [ ] **Step 1: Install the font packages**

Run: `cd frontend && npm install @fontsource/space-grotesk @fontsource/jetbrains-mono`
Then: `ls node_modules/@fontsource/space-grotesk/` — confirm `400.css`,
`500.css`, `600.css`, `700.css` exist (and `node_modules/@fontsource/jetbrains-mono/`
has `400.css`, `500.css`). If only a variable build ships, note the
`@fontsource-variable/space-grotesk` import instead and adjust Step 3.
Commit `package.json` + `package-lock.json` as part of this task's final
commit.

- [ ] **Step 2: Write the failing `ThemeContext` test**

Create `frontend/src/context/ThemeContext.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeContext.js';

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('system')}>system</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeContext', () => {
  it('defaults to system with nothing stored and no attribute', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('honours a stored choice and sets the attribute', () => {
    localStorage.setItem('fumarende.theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('setTheme persists, sets the attribute, and system removes it', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('light'));
    expect(localStorage.getItem('fumarende.theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    fireEvent.click(screen.getByText('system'));
    expect(localStorage.getItem('fumarende.theme')).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('falls back to system on a tampered value', () => {
    localStorage.setItem('fumarende.theme', 'neon');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('system');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/context/ThemeContext.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 4: Write `ThemeContext.tsx`**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type ThemeChoice = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'fumarende.theme';
const CHOICES: ThemeChoice[] = ['system', 'light', 'dark'];

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return CHOICES.includes(v as ThemeChoice) ? (v as ThemeChoice) : 'system';
  } catch {
    return 'system';
  }
}

function applyAttr(choice: ThemeChoice) {
  const el = document.documentElement;
  if (choice === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', choice);
}

interface ThemeContextValue {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(() => readStored());

  useEffect(() => {
    applyAttr(theme);
  }, [theme]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t);
    applyAttr(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* storage unavailable — the in-memory choice still applies */
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
```

- [ ] **Step 5: Font imports in `main.tsx`**

Above `import './theme.css';`:

```ts
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
```

(Adjust to the variable import if Step 1 found only a variable build.)

- [ ] **Step 6: Pre-paint script in `index.html`**

In `<head>`, immediately before `<script type="module" …>`:

```html
    <script>
      try {
        var t = localStorage.getItem('fumarende.theme');
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    </script>
```

- [ ] **Step 7: Mount `ThemeProvider` in `App.tsx`**

```tsx
import { ThemeProvider } from './context/ThemeContext.js';
// …
export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 8: `App.test.tsx` — no wrap needed**

`App.test.tsx` renders `<App />` (which now includes `ThemeProvider`),
so **no change is required**. Run it in Step 9 to confirm; if a test
began asserting `data-theme` it does not — leave it.

- [ ] **Step 9: Run tests + build**

Run: `cd frontend && npx vitest run src/context/ThemeContext.test.tsx src/App.test.tsx`
Expected: PASS.
Run: `cd frontend && npm test`
Expected: all green.
Run: `cd frontend && npm run build`
Expected: exit 0; `dist/assets/` now contains `.woff2` files.

- [ ] **Step 10: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/main.tsx frontend/index.html frontend/src/context/ThemeContext.tsx frontend/src/context/ThemeContext.test.tsx frontend/src/App.tsx
git commit -m "Theme: bundle fonts, ThemeContext (system/light/dark), pre-paint script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `theme.css` token system + class vocabulary + parse test

**Files:**
- Rewrite: `frontend/src/theme.css`
- Create: `frontend/src/theme.test.ts`

**Interfaces:**
- Produces: the full token set on `:root` (light) +
  `:root[data-theme='dark']` + `@media (prefers-color-scheme: dark)
  :root:not([data-theme='light'])`; the alias custom properties; the
  class vocabulary (`.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`,
  `.btn-sm`, `.field`, `.field-label`, `.field-error`, `.page-title`,
  `.section-title`, `.muted`, `.subtle`, `.mono`, `.stack`, `.stack-sm`,
  `.row`, `.row-sm`, `.table-scroll`, `.badge`) plus the kept `.card`,
  `.button-primary`, `.field-input`, `.error-text`, plus the `.nav` /
  `.nav--open` responsive rules used by Task 3.

- [ ] **Step 1: Write the failing parse test**

Create `frontend/src/theme.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.join(__dirname, 'theme.css'), 'utf8');

function propsInBlock(selector: string): Set<string> {
  // grab the {...} that follows `selector` (first match)
  const i = css.indexOf(selector);
  if (i === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  const body = css.slice(open + 1, close);
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
}

describe('theme.css', () => {
  it('keeps the alias custom properties on :root', () => {
    const rootBody = css.slice(css.indexOf(':root {'), css.indexOf('}'));
    for (const alias of ['--card', '--bg2', '--text2', '--text3', '--cyan', '--coral', '--amber', '--sans', '--mono', '--radius']) {
      expect(rootBody).toContain(alias);
    }
  });

  it('the two dark blocks declare the same custom-property names', () => {
    const explicit = propsInBlock("[data-theme='dark']");
    const media = propsInBlock(":root:not([data-theme='light'])");
    expect([...explicit].sort()).toEqual([...media].sort());
    expect(explicit.size).toBeGreaterThan(8);
  });

  it('defines the class vocabulary', () => {
    for (const cls of ['.btn', '.btn-primary', '.btn-ghost', '.field-label', '.page-title', '.section-title', '.stack', '.row', '.table-scroll', '.nav']) {
      expect(css).toContain(cls);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/theme.test.ts`
Expected: FAIL — the current `theme.css` has none of this.

- [ ] **Step 3: Rewrite `theme.css`**

Write the full stylesheet per the spec's Tokens + Class-vocabulary
sections. Key requirements the parse test and Task 3 depend on:

- `:root { … }` contains: the scales (`--space-1..8`, `--text-xs..2xl`,
  `--radius-sm/md/lg`, `--font-sans`, `--font-mono`); the **light**
  semantic tokens (`--bg`, `--bg-elevated`, `--bg-sunken`, `--border`,
  `--border-strong`, `--text`, `--text-muted`, `--text-subtle`,
  `--accent`, `--accent-contrast`, `--violet`, `--danger`, `--warning`,
  `--success`); and the aliases (`--card`, `--bg2`, `--text2`,
  `--text3`, `--cyan`, `--coral`, `--amber`, `--sans`, `--mono`,
  `--radius`) pointing at the semantic ones. `color-scheme: light dark;`.
- `:root[data-theme='dark'] { … }` — the 14 semantic tokens with the
  current dark values (bg `#08080b`, card `#101016`, sunken `#0d0d12`,
  borders as today, text `#eef0f5`/`#8890a0`/`#565d6e`, accent
  `#00e0c6`, etc.).
- `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { … } }`
  — **the same 14 assignments, verbatim**, with a
  `/* KEEP IN SYNC with [data-theme='dark'] */` comment.
- `body` → `background: var(--bg); color: var(--text); font-family:
  var(--font-sans);`. `* { box-sizing; margin:0; padding:0 }` kept.
- `.card` — `background: var(--bg-elevated); border: 1px solid
  var(--border-strong); border-radius: var(--radius-md); padding:
  var(--space-5);` (visually == today).
- `.btn` base + `.btn-primary` (accent fill, `color:
  var(--accent-contrast)`, weight 600) + `.btn-ghost` + `.btn-danger` +
  `.btn-sm`. `.button-primary` re-declared to match `.btn.btn-primary`
  exactly (kept for the ~17 un-migrated files).
- `.field` / `.field-label` / `.field-input` (kept, retuned to tokens) /
  `.field-error` (`= .error-text`). `.error-text` kept.
- `.page-title` (`font-family: var(--font-mono); font-size:
  var(--text-xl); margin-bottom: var(--space-5)`), `.section-title`
  (`--text-lg`, `--space-3`).
- `.muted` / `.subtle` / `.mono` / `.stack` / `.stack-sm` / `.row` /
  `.row-sm` / `.table-scroll` / `.badge`.
- **Focus:** `.btn:focus-visible, .field-input:focus-visible,
  select:focus-visible, a:focus-visible { outline: 2px solid
  var(--accent); outline-offset: 2px; }`.
- **Responsive nav** (consumed by Task 3):
  ```css
  .app { display: flex; min-height: 100vh; }
  .nav { width: 224px; border-right: 1px solid var(--border); padding: var(--space-5) 0;
         display: flex; flex-direction: column; }
  .nav__brand { padding: 0 22px var(--space-5); font-family: var(--font-mono); font-size: var(--text-xl); }
  .nav__topbar { display: none; }
  .main { flex: 1; padding: var(--space-6) var(--space-7); }
  @media (max-width: 800px) {
    .app { flex-direction: column; }
    .nav { width: auto; border-right: none; border-bottom: 1px solid var(--border); padding: 0; }
    .nav__topbar { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); }
    .nav__list { display: none; }
    .nav--open .nav__list { display: flex; flex-direction: column; padding-bottom: var(--space-3); }
    .nav__brand { display: none; }
    .main { padding: var(--space-4); }
  }
  ```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run src/theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + build (regression guard)**

Run: `cd frontend && npm test`
Expected: all green — the ~17 un-migrated files still render because the
aliases resolve; component tests assert text/roles, not colours.
Run: `cd frontend && npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/theme.css frontend/src/theme.test.ts
git commit -m "Theme: token system (light/dark scales), class vocabulary, responsive-nav CSS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `NavShell` — theme toggle, responsive layout, class migration

**Files:**
- Modify: `frontend/src/components/NavShell.tsx`
- Modify: `frontend/src/components/NavShell.test.tsx`

**Interfaces:**
- Consumes: `useTheme` (Task 1), the `.nav*` / `.app` / `.main` classes
  (Task 2).
- Produces: `NavShell` renders a `<div role="group" aria-label="Tema">`
  with `Sistema` / `Claro` / `Escuro` buttons (`aria-pressed`), a
  `<button aria-label="Menu">` hamburger toggling a `menuOpen` state
  (`.nav--open`), and no static `style={{}}`.

- [ ] **Step 1: Update `NavShell.test.tsx`**

- Import `ThemeProvider` and wrap inside `renderShell` (outermost, so
  `document.documentElement` effects run):

```tsx
import { ThemeProvider } from '../context/ThemeContext.js';
// renderShell:
render(
  <ThemeProvider>
    <AuthProvider>
      <MonthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<NavShell />}>
              <Route path="/" element={<div>home</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MonthProvider>
    </AuthProvider>
  </ThemeProvider>,
);
```

- Add to `beforeEach`: `document.documentElement.removeAttribute('data-theme');`
  and to `afterEach` the same.
- Add tests:

```tsx
  it('has a theme control that persists a choice and sets data-theme', async () => {
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Escuro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('fumarende.theme')).toBe('dark');
  });

  it('toggles the mobile nav panel with the hamburger', async () => {
    renderShell();
    const nav = document.querySelector('.nav') as HTMLElement;
    expect(nav.classList.contains('nav--open')).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Menu' }));
    expect(nav.classList.contains('nav--open')).toBe(true);
    // choosing a destination closes it
    fireEvent.click(screen.getByRole('link', { name: 'Receitas' }));
    expect(nav.classList.contains('nav--open')).toBe(false);
  });
```

(The existing "renders the Mês select…" test stays; it still finds
`getByLabelText('Mês')`.)

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npx vitest run src/components/NavShell.test.tsx`
Expected: FAIL — no `Escuro` / `Menu` buttons, no `.nav` element.

- [ ] **Step 3: Rewrite `NavShell.tsx`**

```tsx
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { useMonth } from '../context/MonthContext.js';
import { useTheme } from '../context/ThemeContext.js';

const NAV_ITEMS: { to: string; label: string }[] = [ /* unchanged */ ];

const THEME_CHOICES: { value: 'system' | 'light' | 'dark'; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div role="group" aria-label="Tema" className="theme-toggle">
      {THEME_CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          className="btn btn-sm btn-ghost"
          aria-pressed={theme === c.value}
          onClick={() => setTheme(c.value)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function NavShell() {
  const { logout } = useAuth();
  const { month, setMonth, months } = useMonth();
  const [menuOpen, setMenuOpen] = useState(false);

  const monthSelect = (
    <label className="field nav__month">
      <span className="field-label">Mês</span>
      <select
        aria-label="Mês"
        className="field-input"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      >
        {months.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="app">
      <nav className={`nav${menuOpen ? ' nav--open' : ''}`}>
        <div className="nav__brand">fumarende</div>

        <div className="nav__topbar">
          <span className="mono">fumarende</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost nav__hamburger"
            aria-label="Menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>
        </div>

        <div className="nav__desktop-controls">
          {monthSelect}
          <ThemeToggle />
        </div>

        <div className="nav__list">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
          <button type="button" className="btn btn-sm btn-ghost nav__signout" onClick={() => logout()}>
            Sair
          </button>
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
```

Add the small class set this introduces to `theme.css` (append to
Task 2's rules — it's fine to add them here as part of this task since
they only style `NavShell`): `.theme-toggle` (flex row, `gap:
var(--space-1)`, padding), `.nav__link` (`padding: 9px 22px; font-size:
var(--text-sm); color: var(--text-muted); text-decoration: none;
border-left: 2px solid transparent;`), `.nav__link--active` (`color:
var(--text); border-left-color: var(--accent);`), `.nav__month` (`padding:
0 22px var(--space-3);`), `.nav__signout` (`margin-top: auto; align-self:
flex-start; margin-left: 22px;`), `.nav__desktop-controls` (block),
`.nav__hamburger` (font-size 18). Under `@media (max-width: 800px)`:
`.nav__desktop-controls { display: none }` (month + theme move into the
list / topbar area — simplest: keep them in `.nav__list` on mobile by
also rendering `monthSelect` + `<ThemeToggle/>` at the top of
`.nav__list` and hiding the desktop copy; OR accept that on mobile the
month/theme controls live inside the opened menu). **Decision:** render
`monthSelect` and `<ThemeToggle/>` once, inside `.nav__list`, and delete
`.nav__desktop-controls`; on desktop `.nav__list` is always visible so
they show under the brand; on mobile they appear when the menu opens.
Adjust the JSX accordingly (drop `.nav__desktop-controls`, put
`monthSelect` + `<ThemeToggle/>` as the first children of
`.nav__list`).

- [ ] **Step 4: Run to verify the tests pass**

Run: `cd frontend && npx vitest run src/components/NavShell.test.tsx src/theme.test.ts`
Expected: PASS. (`theme.test.ts` still green — `.nav` etc. present.)

- [ ] **Step 5: Full suite + tsc + build**

Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm run build`
Expected: all green, no type errors, build exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/NavShell.tsx frontend/src/components/NavShell.test.tsx frontend/src/theme.css
git commit -m "NavShell: theme toggle + responsive top-bar/drawer; migrate to classes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `LoginPage` migration

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`
- Modify: `frontend/src/pages/LoginPage.test.tsx`

- [ ] **Step 1: Wrap the test renders in `<ThemeProvider>`**

`LoginPage.test.tsx` currently wraps in `<AuthProvider>`. Add
`<ThemeProvider>` as the outer wrapper in both `render(...)` calls (it
is harmless — `LoginPage` doesn't use it, but keeps parity and lets a
future assertion on `data-theme` work). Actually **skip if LoginPage
does not call `useTheme`** — it doesn't, so no wrap is needed. Leave
`LoginPage.test.tsx` unchanged; run it in Step 3 to confirm.

- [ ] **Step 2: Migrate `LoginPage.tsx`**

```tsx
  return (
    <div className="card login-card">
      <h1 className="page-title">{isSetupMode ? 'Criar senha' : 'fumarende'}</h1>
      <form onSubmit={handleSubmit} className="stack-sm">
        <label className="field">
          <span className="field-label">Senha</span>
          <input
            id="password"
            type="password"
            className="field-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        <button type="submit" className="btn btn-primary login-submit">
          {isSetupMode ? 'Criar' : 'Entrar'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
```

Add to `theme.css`: `.login-card { max-width: 360px; margin: var(--space-8) auto; }`
and `.login-submit { width: 100%; }`. Keep the `<input id="password">`
so `getByLabelText('Senha')` still resolves (the `<label>` now wraps it
— label association by nesting works; if the test used
`getByLabelText`, verify it still matches, else keep `htmlFor`/`id`).

> The existing test does `screen.findByLabelText('Senha')`. Nesting the
> input in `<label><span>Senha</span><input/></label>` associates them,
> so `getByLabelText('Senha')` resolves. If jsdom is fussy about the
> `<span>`, use `<label htmlFor="password">Senha</label>` +
> `<input id="password">` instead — same result, keep whichever the
> test passes with.

- [ ] **Step 3: Run tests + build**

Run: `cd frontend && npx vitest run src/pages/LoginPage.test.tsx src/App.test.tsx`
Expected: PASS.
Run: `cd frontend && npm test && npm run build`
Expected: all green, build exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/theme.css
git commit -m "LoginPage: migrate to the class vocabulary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `DashboardPage` migration

**Files:**
- Modify: `frontend/src/pages/DashboardPage.tsx`
- Modify: `frontend/src/pages/DashboardPage.test.tsx`

- [ ] **Step 1: Wrap the test in `<ThemeProvider>` (defensive)**

`DashboardPage` does not call `useTheme`, so no wrap is strictly
needed. Leave `DashboardPage.test.tsx`'s `renderPage` as-is (it wraps in
`<MonthProvider>`); run it in Step 3 to confirm nothing regressed.

- [ ] **Step 2: Migrate `DashboardPage.tsx`**

Replace the static `style={{}}` objects with classes:

- The outer `<h1 style={{ fontFamily: 'var(--mono)', fontSize: 20, … }}>`
  → `<h1 className="page-title">`.
- `const cardGap = { marginBottom: 24 }` → a `.stack` wrapper around the
  cards (`<div className="stack">…</div>`), drop `cardGap`.
- `const h2Style` → `className="section-title"` on every `<h2>`.
- The stat-row `<div className="card" style={{ display:'flex',
  flexWrap:'wrap', gap:20, … }}>` → `<div className="card row">` (the
  `.row` class provides flex+wrap+gap).
- Each stat block's `<div style={{ color:'var(--text3)', fontSize:11 }}>`
  label → `<div className="subtle">`; the mono value → `<div
  className="mono dash-stat">` with `.dash-stat { font-size:
  var(--text-lg); }` added to `theme.css`.
- `<Delta>` sub-component's inline `<span style={{ fontSize:11,
  color:'var(--text3)' }}>` variants → `className="subtle"` /
  `className="subtle dash-delta-up"` / `dash-delta-down` with
  `.dash-delta-up { color: var(--accent); }` and `.dash-delta-down {
  color: var(--danger); }` in `theme.css`.
- Alert lines: `<div style={{ fontSize:12.5, color: ALERT_COLOR[a.level],
  … }}>` → keep the level→class map instead of the colour map:
  `const ALERT_CLASS = { info:'muted', warning:'dash-alert-warning',
  danger:'dash-alert-danger' }` with those two classes in `theme.css`
  (`color: var(--warning)` / `var(--danger)`).
- The evolution `<svg>` — keep its inline `viewBox`/`points` (dynamic
  geometry); wrap it in `<div className="table-scroll">` is unnecessary
  (it's `width:100%`); just move `style={{ width:'100%', height:90 }}`
  to a `.dash-evo` class.
- Recent-expense rows, goal rows, installment card, "Fechamento do mês"
  — replace their flex/spacing/border inline styles with `.row`,
  `.stack-sm`, and small page-scoped classes
  (`.dash-list-row { display:flex; justify-content:space-between;
  gap: var(--space-3); padding: var(--space-2) 0; border-bottom: 1px
  solid var(--border); font-size: var(--text-sm); }`).
- Goal progress bar: keep `style={{ width: \`${g.progressPct}%\` }}` on
  the inner div (dynamic); move the track/fill colours to
  `.dash-goal-track` / `.dash-goal-fill` classes.
- `.error-text` line stays.

All new `dash-*` and generic classes go in `theme.css`. The page must
render the same in dark mode.

- [ ] **Step 3: Run tests + tsc + build**

Run: `cd frontend && npx vitest run src/pages/DashboardPage.test.tsx src/App.test.tsx`
Expected: PASS (the tests query `getByRole('heading', { name: 'Dashboard' })`,
`findByText`, `findByTestId('bar-…')`, `getByLabelText('Revisado …')` —
none depend on inline styles).
Run: `cd frontend && npm test && ./node_modules/.bin/tsc -p tsconfig.json --noEmit && npm run build`
Expected: all green, no type errors, build exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/DashboardPage.tsx frontend/src/theme.css
git commit -m "DashboardPage: migrate to the class vocabulary

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Build verify, live smoke, docs

**Files:**
- Modify: `docs/qa-checklist.md`
- Modify: `README.md`

- [ ] **Step 1: Full frontend sweep + build**

Run: `cd frontend && npm test` — all green.
Run: `cd frontend && ./node_modules/.bin/tsc -p tsconfig.json --noEmit` — clean.
Run: `cd frontend && npm run build` — exit 0; confirm `dist/assets/`
contains `.woff2` files and the CSS chunk grew (≈4–6 KB).

- [ ] **Step 2: Server suite + e2e unaffected**

Run: `cd server && npm test` — unchanged, all green.
Run: `bash scripts/qa-e2e.sh` — unchanged count, `0 failed` (2.5.1 adds
no API surface).

- [ ] **Step 3: Rebuild + restart live server + browser smoke**

```bash
cd frontend && npm run build
launchctl kickstart -k "gui/$(id -u)/com.lucca.fumarende"
sleep 1.5
curl -s -o /dev/null -w 'home: %{http_code}\n' http://localhost:4173/
curl -s http://localhost:4173/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.\(js\|css\)'
```

Manual: hard-refresh. Toggle Sistema / Claro / Escuro under the wordmark
→ the whole app recolours; reload → the choice sticks; "Sistema" follows
the OS. Headings are Space Grotesk, mono bits JetBrains Mono, no
`fonts.googleapis.com` request in devtools. Narrow the window past
~800px → the sidebar becomes a top bar with a working hamburger. Dark
mode looks like it did before.

- [ ] **Step 4: Docs**

`docs/qa-checklist.md` — bump the frontend test count in the header;
add a `## Design system foundation (Phase 2.5.1)` section:

```markdown
- [x] `ThemeContext` — defaults to `system`, honours a stored
      `light`/`dark`, `setTheme` persists to `localStorage` and sets /
      clears `data-theme` on `<html>`, a tampered value falls back to
      `system`, `useTheme()` throws outside a provider (5 unit tests).
- [x] `theme.css` — the two dark blocks declare the same custom-property
      names; the alias tokens (`--card`, `--text2`, `--text3`, `--cyan`,
      …) stay defined so un-migrated pages render unchanged; the class
      vocabulary (`.btn*`, `.field*`, `.page-title`, `.section-title`,
      `.stack`, `.row`, `.table-scroll`, `.nav`) is present (parse test).
- [x] `NavShell` — a Sistema/Claro/Escuro control sets and persists the
      theme; the `Menu` hamburger toggles `.nav--open` and a nav-link
      click closes it (2 unit tests). The `Mês` select still works.
- [x] `LoginPage` / `DashboardPage` migrated to the class vocabulary;
      their existing text/role tests stay green.
- [x] Fonts are bundled — `npm run build` emits `.woff2` into
      `dist/assets`; no `fonts.googleapis.com` request.
- [ ] Browser: light/dark toggle recolours the app and persists across
      reloads; "Sistema" follows the OS; below ~800px the nav is a top
      bar + hamburger; dark mode is visually unchanged from before.
```

`README.md` — under Phase 2.5, mark 2.5.1 done (foundation: tokens,
bundled fonts, light/dark toggle, responsive nav; NavShell/Login/
Dashboard migrated). 2.5.2 (migrate the remaining pages) is next.

- [ ] **Step 5: Commit**

```bash
git add docs/qa-checklist.md README.md
git commit -m "Design foundation: docs + checklist"
```

---

## Self-Review

**Spec coverage**

| Spec item | Task |
|---|---|
| `@fontsource/*` installed, imported in `main.tsx` | 1 |
| `ThemeContext` (`system`/`light`/`dark`), `localStorage`, `data-theme`, fallback, throws outside provider | 1 |
| pre-paint `<script>` in `index.html` | 1 |
| `ThemeProvider` at the top of `App` (covers `/login`) | 1 |
| `theme.css` — scales, light `:root`, dark `[data-theme]` + media query (in sync), aliases kept | 2 |
| class vocabulary (`.btn*`, `.field*`, titles, layout, `.table-scroll`, `.badge`) + kept classes | 2 |
| `:focus-visible` outlines | 2 |
| responsive-nav CSS (`.app`/`.nav`/`.main`/`@media 800px`) | 2 |
| `theme.test.ts` — dark-block parity + aliases + vocabulary present | 2 |
| `NavShell` theme toggle (`role="group"`, 3 `aria-pressed` buttons) | 3 |
| `NavShell` `<800px` top-bar + `Menu` hamburger + `menuOpen` → `.nav--open`, link click closes | 3 |
| `NavShell` no static `style={{}}` | 3 |
| `NavShell.test` — provider wrap + toggle + hamburger tests; `Mês` still works | 3 |
| `LoginPage` migrated; `getByLabelText('Senha')` still resolves | 4 |
| `DashboardPage` migrated; dynamic styles (progress width, SVG geom) kept; tests green | 5 |
| build emits `.woff2`; no Google Fonts request | 1, 6 |
| `docs/qa-checklist.md` + `README.md` | 6 |
| other 17 files untouched, alias tokens keep them identical in both themes | constraints + 2 |
| no server / e2e change | constraints + 6 |

**Placeholder scan:** no `TODO`/`TBD`. Task 2 Step 3 and Task 5 Step 2
describe the CSS/JSX in prose but pin every selector name, token name,
and class the parse test and Task 3 depend on; `ThemeContext.tsx`,
`theme.test.ts`, and `NavShell.tsx` are given in full. The two
"jsdom fussy about `<span>` label" asides name the concrete fallback
(`htmlFor`/`id`) and keep the observable assertion (`getByLabelText('Senha')`)
fixed.

**Type consistency:**
- `ThemeChoice = 'system' | 'light' | 'dark'` — identical in
  `ThemeContext.tsx` (Task 1), the `THEME_CHOICES` array and
  `ThemeToggle` in `NavShell.tsx` (Task 3), and the `ThemeContext.test`
  probe buttons.
- `useTheme()` / `ThemeProvider` — Task 1 exports; consumed by
  `NavShell` (Task 3) and wrapped by `App` (Task 1) and `NavShell.test`
  (Task 3).
- `STORAGE_KEY = 'fumarende.theme'` — the same string in
  `ThemeContext.tsx`, `index.html`'s script, `ThemeContext.test`, and
  `NavShell.test` (`localStorage.getItem('fumarende.theme')`).
- Class names introduced in Task 2's CSS (`.nav`, `.nav--open`,
  `.nav__list`, `.btn`, `.btn-ghost`, `.btn-sm`, `.field`,
  `.field-label`, `.page-title`, `.section-title`, `.stack`,
  `.stack-sm`, `.row`, `.subtle`, `.mono`) are exactly the ones
  `NavShell.tsx` / `LoginPage.tsx` / `DashboardPage.tsx` reference in
  Tasks 3–5; page-scoped `dash-*` / `login-*` / `nav__*` classes are
  added to `theme.css` in the same task that introduces their usage.
- `theme.test.ts` selector strings (`":root {"`, `"[data-theme='dark']"`,
  `":root:not([data-theme='light'])"`, `.btn`, `.nav`, …) match the
  selectors Task 2 writes verbatim.
