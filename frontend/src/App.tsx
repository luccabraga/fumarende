import { AuthProvider, useAuth } from './context/AuthContext.js';
import { LoginPage } from './pages/LoginPage.js';

function Gate() {
  const { passwordSet, authenticated } = useAuth();
  if (passwordSet === null) return null; // status still loading
  if (!authenticated) return <LoginPage />;
  return <p style={{ padding: 24 }}>Logged in — app shell arrives in Task 11.</p>;
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
