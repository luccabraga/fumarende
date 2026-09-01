import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { useMonth } from '../context/MonthContext.js';
import { useTheme } from '../context/ThemeContext.js';

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/receitas', label: 'Receitas' },
  { to: '/cambio', label: 'Câmbio' },
  { to: '/gastos', label: 'Gastos' },
  { to: '/parcelas', label: 'Parcelas' },
  { to: '/reserva', label: 'Reserva' },
  { to: '/metas', label: 'Metas' },
  { to: '/projetos', label: 'Projetos Especiais' },
  { to: '/analise', label: 'Análise' },
  { to: '/historico-dolar', label: 'Histórico Dólar' },
  { to: '/backup', label: 'Backup & Dados' },
];

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

        <div className="nav__list">
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

          <button
            type="button"
            className="btn btn-sm btn-ghost nav__signout"
            onClick={() => logout()}
          >
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
