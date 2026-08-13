import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';

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

export function NavShell() {
  const { logout } = useAuth();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <nav
        style={{
          width: 224,
          borderRight: '1px solid var(--border)',
          padding: '24px 0',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '0 22px 22px', fontFamily: 'var(--mono)', fontSize: 19 }}>
          fumarende
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              padding: '9px 22px',
              fontSize: 13,
              color: isActive ? 'var(--text)' : 'var(--text2)',
              borderLeft: isActive ? '2px solid var(--cyan)' : '2px solid transparent',
              textDecoration: 'none',
            })}
          >
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={() => logout()}
          style={{
            marginTop: 'auto',
            marginLeft: 22,
            background: 'none',
            border: 'none',
            color: 'var(--text3)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          Sair
        </button>
      </nav>
      <main style={{ flex: 1, padding: '32px 40px' }}>
        <Outlet />
      </main>
    </div>
  );
}
