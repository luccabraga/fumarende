import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ReceitasPage } from './pages/ReceitasPage.js';
import { CambioPage } from './pages/CambioPage.js';
import { PlaceholderPage } from './pages/PlaceholderPage.js';
import { NavShell } from './components/NavShell.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';

function Router() {
  const { passwordSet, authenticated } = useAuth();
  if (passwordSet === null) return null;

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={authenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route element={<ProtectedRoute />}>
          <Route element={<NavShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/receitas" element={<ReceitasPage />} />
            <Route path="/cambio" element={<CambioPage />} />
            <Route path="/gastos" element={<PlaceholderPage title="Gastos" />} />
            <Route path="/parcelas" element={<PlaceholderPage title="Parcelas" />} />
            <Route path="/reserva" element={<PlaceholderPage title="Reserva" />} />
            <Route path="/metas" element={<PlaceholderPage title="Metas" />} />
            <Route path="/projetos" element={<PlaceholderPage title="Projetos Especiais" />} />
            <Route path="/analise" element={<PlaceholderPage title="Análise" />} />
            <Route path="/historico-dolar" element={<PlaceholderPage title="Histórico Dólar" />} />
            <Route path="/backup" element={<PlaceholderPage title="Backup & Dados" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Router />
    </AuthProvider>
  );
}
