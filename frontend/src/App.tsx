import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ReceitasPage } from './pages/ReceitasPage.js';
import { CambioPage } from './pages/CambioPage.js';
import { GastosPage } from './pages/GastosPage.js';
import { ParcelasPage } from './pages/ParcelasPage.js';
import { ReservaPage } from './pages/ReservaPage.js';
import { MetasPage } from './pages/MetasPage.js';
import { ProjetosPage } from './pages/ProjetosPage.js';
import { AnalisePage } from './pages/AnalisePage.js';
import { HistoricoDolarPage } from './pages/HistoricoDolarPage.js';
import { BackupDadosPage } from './pages/BackupDadosPage.js';
import { NavShell } from './components/NavShell.js';
import { ProtectedRoute } from './components/ProtectedRoute.js';
import { MonthProvider } from './context/MonthContext.js';
import { ThemeProvider } from './context/ThemeContext.js';

function AppShell() {
  return (
    <MonthProvider>
      <NavShell />
    </MonthProvider>
  );
}

function Router() {
  const { passwordSet, authenticated } = useAuth();
  if (passwordSet === null) return <div className="app-boot" />;

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={authenticated ? <Navigate to="/" replace /> : <LoginPage />}
        />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/receitas" element={<ReceitasPage />} />
            <Route path="/cambio" element={<CambioPage />} />
            <Route path="/gastos" element={<GastosPage />} />
            <Route path="/parcelas" element={<ParcelasPage />} />
            <Route path="/reserva" element={<ReservaPage />} />
            <Route path="/metas" element={<MetasPage />} />
            <Route path="/projetos" element={<ProjetosPage />} />
            <Route path="/analise" element={<AnalisePage />} />
            <Route path="/historico-dolar" element={<HistoricoDolarPage />} />
            <Route path="/backup" element={<BackupDadosPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router />
      </AuthProvider>
    </ThemeProvider>
  );
}
