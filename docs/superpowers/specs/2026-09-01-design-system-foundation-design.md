# fumarende — design system foundation (Phase 2.5.1)

> **Phase 2.5, sub-slice 1 of ~4.** Phase 2 (all Claude slices) is
> complete. Phase 2.5 is a UX/UI polish pass, decomposed:
> **2.5.1 foundation** / 2.5.2 migrate inline styles / 2.5.3 states &
> feedback / 2.5.4 a11y audit. Each its own brainstorm → spec → plan
> cycle. This spec covers 2.5.1.

## Context

The frontend's design lives in ~280 inline `style={{}}` objects across
20 files, driving off a 69-line `theme.css`: a dark palette
(`--bg/--card/--text/--text2/--text3`, accents `--cyan/--violet/--coral/--amber`),
`--mono`/`--sans`/`--radius`, and four classes (`.card`,
`.button-primary`, `.field-input`, `.error-text`). Two problems:

1. **The fonts are never loaded.** `--mono: 'JetBrains Mono'` and
   `--sans: 'Space Grotesk'` are referenced but there is no `@font-face`
   or font link anywhere — it silently falls back to system fonts.
2. **Dark-only, no toggle**, no `prefers-color-scheme`. The 224px
   sidebar has no mobile treatment.

2.5.1 builds the foundation the rest of 2.5 stands on: real fonts, an
expanded token set with a light theme + toggle, a reusable class
vocabulary, and a responsive nav — applied as a proof to the shell,
Login, and Dashboard. It does **not** migrate the other 17 files'
inline styles (that's 2.5.2).

Decisions from the 2026-09-01 brainstorm:

- **Scope:** foundation only. Apply the new classes to `NavShell`,
  `LoginPage`, `DashboardPage`; leave every other file on inline styles
  + alias tokens.
- **Direction:** keep and systematize the current dark terminal look;
  add a light counterpart. No redesign, no new palette beyond deriving
  light.
- **Light mode:** a full light theme, `prefers-color-scheme` default, a
  manual toggle persisted to `localStorage`.
- **Fonts:** bundled locally via `@fontsource/*` packages.

## Goals

- `@fontsource/space-grotesk` + `@fontsource/jetbrains-mono` installed
  and imported; the app renders in the intended fonts offline.
- `theme.css` expanded to a token system: semantic surface/text/accent
  tokens with **light** (`:root`) and **dark**
  (`:root[data-theme="dark"]` + `prefers-color-scheme`) values; spacing,
  type, and radius scales. Old token names kept as aliases.
- `ThemeContext` (`'system' | 'light' | 'dark'`), persisted to
  `localStorage['fumarende.theme']`, sets `data-theme` on
  `document.documentElement`. A pre-paint script in `index.html`
  prevents a flash.
- A reusable class vocabulary in `theme.css` (`.btn*`, `.field*`,
  `.page-title`, `.section-title`, `.stack`, `.row`, `.muted`,
  `.subtle`, `.table-scroll`, `.badge`) alongside the kept classes.
- `NavShell` gains a theme toggle and a responsive layout: under
  ~800px, a top bar + hamburger drawer; `<main>` full-width.
- `NavShell`, `LoginPage`, `DashboardPage` fully migrated to the class
  vocabulary (no `style={{}}` left in those three, save genuinely
  dynamic values like a progress-bar width).

## Non-goals

- **No migration of the other 17 files.** They keep their inline styles;
  the alias tokens keep them pixel-identical. That is 2.5.2.
- **No redesign.** Same layout, same type hierarchy, same cyan accent.
  The light palette is *derived* from the dark one, not a new identity.
- **No loading/empty/error-state unification** (2.5.3), **no a11y audit
  pass** (2.5.4) beyond the focus states the toggle/nav naturally need.
- No server change, no new API, no e2e change.
- No CSS framework (Tailwind etc.) and no CSS-in-JS. Plain `theme.css`
  with custom properties + hand-written classes.
- No change to the 12 nav items or their order (nav *grouping* is a
  later 2.5 concern).

## Architecture

### Fonts

`frontend/package.json` — add to `dependencies`:
`@fontsource/space-grotesk`, `@fontsource/jetbrains-mono`. (These are
build-time asset packages: Vite inlines the `@font-face` + `woff2` into
the bundle. No runtime library, no network request. This is the single
dependency exception, per the "bundle locally" decision.)

`frontend/src/main.tsx` — before `import './theme.css'`, import the
weight CSS files the app uses:

```ts
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
```

(Task 1 runs `ls frontend/node_modules/@fontsource/space-grotesk/` once
to confirm these weight files exist for the installed version and
adjusts the list if the package only ships a variable build, in which
case `@fontsource-variable/space-grotesk` + its single import is used.)

`theme.css` — `--font-sans` and `--font-mono` reference the loaded
family names with a full system fallback stack:

```css
--font-sans: 'Space Grotesk', 'Space Grotesk Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', 'Menlo', monospace;
```

Keep `--sans` / `--mono` as aliases (`--sans: var(--font-sans)`).

### Tokens — `frontend/src/theme.css`

Structure:

```css
:root {
  /* ---- scales (theme-independent) ---- */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
  --text-xs: 11px; --text-sm: 12.5px; --text-md: 14px;
  --text-lg: 16px; --text-xl: 20px;  --text-2xl: 28px;
  --radius-sm: 8px; --radius-md: 10px; --radius-lg: 14px;
  --font-sans: /* … */;  --font-mono: /* … */;

  /* ---- LIGHT theme (default) ---- */
  --bg:            #f7f6f3;
  --bg-elevated:   #ffffff;   /* cards */
  --bg-sunken:     #efeeea;   /* inputs */
  --border:        rgba(20, 20, 30, 0.10);
  --border-strong: rgba(20, 20, 30, 0.18);
  --text:          #1a1c22;
  --text-muted:    #5c6270;
  --text-subtle:   #8b909c;
  --accent:        #00b7a2;   /* cyan, darkened for contrast on light */
  --accent-contrast: #ffffff;
  --violet:        #6b52d6;
  --danger:        #d63a58;
  --warning:       #c77c11;
  --success:       #1a9463;

  /* ---- aliases (so un-migrated inline styles keep working) ---- */
  --card: var(--bg-elevated);
  --bg2: var(--bg-sunken);
  --text2: var(--text-muted);
  --text3: var(--text-subtle);
  --cyan: var(--accent);
  --coral: var(--danger);
  --amber: var(--warning);
  --sans: var(--font-sans);
  --mono: var(--font-mono);
  --radius: var(--radius-md);
}

:root[data-theme='dark'] {
  --bg:            #08080b;
  --bg-elevated:   #101016;
  --bg-sunken:     #0d0d12;
  --border:        rgba(255, 255, 255, 0.07);
  --border-strong: rgba(255, 255, 255, 0.14);
  --text:          #eef0f5;
  --text-muted:    #8890a0;
  --text-subtle:   #565d6e;
  --accent:        #00e0c6;
  --accent-contrast: #08080b;
  --violet:        #8b6bff;
  --danger:        #ff5470;
  --warning:       #ffb020;
  --success:       #34d399;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    /* KEEP IN SYNC with :root[data-theme='dark'] above — same 12
       custom-property assignments, verbatim. A one-line comment marks
       both blocks; a unit test asserts the two blocks declare the same
       property names (see Testing). */
  }
}
```

The dark values are written twice (the explicit `[data-theme='dark']`
selector and this media query). They are kept identical by hand, flagged
with the comment above, and guarded by a `theme.css` parse test that
checks both dark blocks assign the same set of property names.

`body` gets `background: var(--bg); color: var(--text); font-family:
var(--font-sans);` and a `color-scheme: light dark;` on `:root` so
form controls / scrollbars follow.

### `ThemeContext` — `frontend/src/context/ThemeContext.tsx`

Mirrors `MonthContext`:

```ts
type ThemeChoice = 'system' | 'light' | 'dark';
interface ThemeContextValue {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
}
function ThemeProvider({ children }: { children: ReactNode }): JSX.Element;
function useTheme(): ThemeContextValue;   // throws outside a provider
```

- `STORAGE_KEY = 'fumarende.theme'`. Initial value: a valid choice from
  `localStorage`, else `'system'`. All storage access `try/catch`.
- `setTheme` writes through to `localStorage` and applies the DOM
  attribute immediately.
- A `useEffect` (or `useLayoutEffect`) keeps
  `document.documentElement`'s `data-theme` in sync: `'system'` →
  remove the attribute; `'light'`/`'dark'` → set it.
- Mounted at the top of `App` (outside the router, so it also covers
  `/login`).

### Pre-paint script — `frontend/index.html`

In `<head>`, before the module script:

```html
<script>
  try {
    var t = localStorage.getItem('fumarende.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
</script>
```

So a non-system choice paints correctly on the first frame.

### Class vocabulary — added to `theme.css`

Kept: `.card`, `.button-primary`, `.field-input`, `.error-text`
(unchanged selectors so nothing breaks; `.button-primary` may be
redefined as `composes`-style shorthand but must render identically).

New:

| Class | Purpose |
|---|---|
| `.btn` | base button reset (padding, radius, font, cursor, `border:1px solid transparent`, focus ring) |
| `.btn-primary` | accent fill (`= .button-primary`; `.button-primary` becomes an alias) |
| `.btn-ghost` | transparent, border `--border-strong`, `--text` |
| `.btn-danger` | `--danger` fill |
| `.btn-sm` | smaller padding/font modifier |
| `.field` | a labelled-control wrapper (`display:flex; flex-direction:column; gap:var(--space-1)`) |
| `.field-label` | the `<label>` style (`--text-sm`, `--text-muted`) |
| `.field-error` | `= .error-text` alias |
| `.page-title` | `<h1>`: `--font-mono`, `--text-xl`, margin-bottom `--space-5` |
| `.section-title` | `<h2>`: `--font-mono`, `--text-lg`, margin-bottom `--space-3` |
| `.muted` | `color: var(--text-muted)` |
| `.subtle` | `color: var(--text-subtle); font-size: var(--text-xs)` |
| `.mono` | `font-family: var(--font-mono)` |
| `.stack` / `.stack-sm` | `display:flex; flex-direction:column; gap: var(--space-4)` / `--space-2` |
| `.row` / `.row-sm` | `display:flex; gap: var(--space-3); flex-wrap:wrap; align-items:center` / `--space-2` |
| `.table-scroll` | `overflow-x:auto; -webkit-overflow-scrolling:touch` wrapper |
| `.badge` | small pill: `--text-xs`, `--bg-sunken` bg, `--text-muted`, rounded |

Every interactive element (`.btn*`, `.field-input`, `select`, nav links)
gets a visible `:focus-visible` outline using `--accent`.

### Responsive nav — `frontend/src/components/NavShell.tsx`

- A `--nav-breakpoint` of `800px`.
- **≥ 800px** (unchanged): the 224px left sidebar, `<main>` beside it.
- **< 800px**: the sidebar becomes a **top bar** (wordmark + the `Mês`
  select + a hamburger button `aria-label="Menu"` + the theme toggle);
  the nav-link list + "Sair" collapse into a panel toggled by a
  `const [menuOpen, setMenuOpen]` state (starts closed). Clicking a
  `NavLink` closes it. `<main>` is full-width with `--space-4` padding.
- Implemented with a `.nav` / `.nav--open` class pair + media queries in
  `theme.css`; the `menuOpen` state only toggles `.nav--open`.
- The theme toggle: a `<div role="group" aria-label="Tema">` with three
  `<button>`s — `Sistema`, `Claro`, `Escuro` — each with
  `aria-pressed={theme === choice}`; clicking one calls
  `setTheme(choice)`. Placed under the wordmark on desktop, in the top
  bar on mobile.

### Proof migration — `NavShell`, `LoginPage`, `DashboardPage`

Replace `style={{}}` with the vocabulary. Keep only genuinely dynamic
inline styles (e.g. a goal progress bar's `width: ${pct}%`, an
evolution polyline's computed points). After this slice these three
files have no static `style={{}}`; the SVG charts keep their inline
geometry.

Component tests for these three assert on **text and roles**, not
styles — they must keep passing unchanged. Any test that happens to
query by a style is updated to query by role/text/testid.

## Data flow

1. `index.html`'s inline script sets `data-theme` from `localStorage`
   before React mounts (no flash for a saved choice).
2. `ThemeProvider` (top of `App`) reads the same key, renders the
   toggle's current state, and on `setTheme` writes `localStorage` +
   updates `document.documentElement`.
3. `theme.css` resolves every token from `:root` / `[data-theme]` /
   `prefers-color-scheme`; migrated components read them via classes,
   un-migrated ones via the alias custom properties — both themes work
   for both.
4. `NavShell`'s `menuOpen` state toggles `.nav--open`; CSS media
   queries do the rest.

## Error handling

- All `localStorage` reads/writes in `ThemeContext` and the inline
  script are `try/catch`-guarded; a failure falls back to `'system'`.
- `useTheme()` outside a provider throws (same contract as `useMonth`).
- An unknown stored value (`localStorage` tampered) is treated as
  `'system'`.

## Testing

**Frontend (new / changed):**

- `context/ThemeContext.test.tsx` (new):
  - default is `'system'` with nothing stored; `data-theme` attribute is
    absent.
  - a stored `'dark'` is used and sets `document.documentElement`'s
    `data-theme` to `'dark'`.
  - `setTheme('light')` updates the value, writes
    `localStorage['fumarende.theme']`, and sets the attribute; `setTheme('system')`
    removes it.
  - an invalid stored value falls back to `'system'`.
  - `useTheme()` outside a provider throws.
- `components/NavShell.test.tsx` (updated — it already renders inside
  `<MonthProvider>` + `<MemoryRouter>`; add `<ThemeProvider>`):
  - a theme control is present; activating "Escuro" sets
    `data-theme="dark"` on `document.documentElement` and persists it.
  - the hamburger (`aria-label="Menu"`) toggles a `nav--open` state:
    the nav list is present after opening; clicking a `NavLink` closes
    it. (Assert via the class on the nav container or the
    presence/visibility of a link — jsdom has no layout, so test the
    class/`menuOpen` effect, not computed visibility.)
- `pages/LoginPage.test.tsx`, `pages/DashboardPage.test.tsx`,
  `App.test.tsx` — wrap in `<ThemeProvider>` where they render the shell
  / a migrated page; existing assertions (text, roles, `getByLabelText`)
  stay green. No new assertions required beyond what a wrap needs.
- `theme.test.ts` (new) — reads `frontend/src/theme.css` as text and
  asserts: `:root[data-theme='dark']` and the
  `@media (prefers-color-scheme: dark)` block assign the **same set** of
  custom-property names; every alias (`--card`, `--text2`, `--text3`,
  `--cyan`, `--coral`, `--amber`, `--sans`, `--mono`, `--radius`) is
  still defined on `:root`.
- `context/MonthContext.test.tsx` and others — untouched (no
  `ThemeProvider` needed; they don't render the shell).

**Build:** `cd frontend && npm run build` — exit 0; the bundle now
includes the two font families (`dist/assets/*.woff2`), CSS grows to
~4–6 KB.

**No server test / e2e change** — 2.5.1 is frontend-only.

**Manual (browser):**
- Toggle Sistema / Claro / Escuro → the whole app recolours; reload →
  the choice sticks; with "Sistema", flipping the OS appearance flips
  the app.
- Headings render in Space Grotesk, mono bits in JetBrains Mono, with
  no network request (check devtools → Network shows the woff2 from the
  bundle, not fonts.googleapis.com).
- Narrow the window past ~800px → the sidebar becomes a top bar with a
  working hamburger; tables/wide cards scroll rather than overflow the
  page.
- Dashboard, Login, and the nav look identical to before in dark mode
  (systematized, not redesigned).

## Files

**New:**
- `frontend/src/context/ThemeContext.tsx` + `.test.tsx`
- `frontend/src/theme.test.ts` (parses `theme.css`)

**Modified:**
- `frontend/package.json` — `@fontsource/space-grotesk`,
  `@fontsource/jetbrains-mono`
- `frontend/index.html` — pre-paint theme script
- `frontend/src/main.tsx` — font imports
- `frontend/src/theme.css` — the token system + class vocabulary +
  responsive-nav rules (69 → ~220 lines)
- `frontend/src/App.tsx` — mount `<ThemeProvider>` at the top
- `frontend/src/components/NavShell.tsx` — theme toggle, responsive
  layout, class migration
- `frontend/src/components/NavShell.test.tsx` — provider wrap + toggle /
  hamburger tests
- `frontend/src/pages/LoginPage.tsx` — class migration
- `frontend/src/pages/DashboardPage.tsx` — class migration
- `frontend/src/pages/LoginPage.test.tsx`,
  `frontend/src/pages/DashboardPage.test.tsx`, `frontend/src/App.test.tsx`
  — `<ThemeProvider>` wrap
- `docs/qa-checklist.md` — a 2.5.1 section (mostly browser checks)
- `README.md` — Phase 2.5 status: 2.5.1 done

## Security / privacy notes

- Fonts are bundled — **no request to fonts.googleapis.com**, nothing
  leaks to Google, works fully offline on the LAN.
- `localStorage['fumarende.theme']` holds one of three literal strings;
  no financial data, per-browser only.
- No new network surface, no server change.
