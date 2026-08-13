import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';

export function ProtectedRoute() {
  const { passwordSet, authenticated } = useAuth();
  if (passwordSet === null) return null;
  if (!authenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
