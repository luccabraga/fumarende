import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { useMonth } from '../context/MonthContext.js';
import { useTheme } from '../context/ThemeContext.js';

const NAV_HOME = { to: '/', label: 'Dashboard' };

const NAV_GROUPS: { label: string; items: { to: string; label: string }[] }[] = [
  {
    label: 'Entradas',
    items: [
      { to: '/receitas', label: 'Receitas' },
      { to: '/cambio', label: 'Câmbio' },
      { to: '/historico-dolar', label: 'Dólar' },
    ],
  },
  {
    label: 'Saídas',
    items: [
      { to: '/gastos', label: 'Gastos' },
      { to: '/parcelas', label: 'Parcelas' },
    ],
  },
  {
    label: 'Reserva & Metas',
    items: [
      { to: '/reserva', label: 'Reserva' },
      { to: '/metas', label: 'Metas' },
      { to: '/projetos', label: 'Projetos' },
    ],
  },
  {
    label: 'Análise',
    items: [{ to: '/analise', label: 'Análise' }],
  },
  {
    label: 'Config',
    items: [{ to: '/backup', label: 'Backup & Dados' }],
  },
];

const THEME_CHOICES: { value: 'light' | 'dark'; label: string }[] = [
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
          className="btn btn-sm"
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

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Pular para o conteúdo
      </a>
      <nav aria-label="Navegação principal" className={`nav${menuOpen ? ' nav--open' : ''}`}>
        <div className="nav__brand">fumarende</div>

        <div className="nav__topbar">
          <span className="mono">fumarende</span>
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
        </div>

        <div className="nav__list" id="nav-list">
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

          <ThemeToggle />

          <NavLink
            to={NAV_HOME.to}
            end
            className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
            onClick={() => setMenuOpen(false)}
          >
            {NAV_HOME.label}
          </NavLink>

          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="nav__group">
              <span className="nav__group-label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}

          <button
            type="button"
            className="btn btn-sm btn-ghost nav__signout"
            onClick={() => logout()}
          >
            Sair
          </button>
        </div>
      </nav>

      <main className="main" id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
