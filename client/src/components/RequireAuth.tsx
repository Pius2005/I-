import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../lib/auth';
import { homeForRole, useAuth } from '../lib/auth';
import { Spinner } from './ui';

export function RequireAuth({ roles }: { roles: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
        <span className="sr-only">Loading your session</span>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!roles.includes(user.role)) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }
  return <Outlet />;
}

export function RedirectIfAuthed({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  if (user) return <Navigate to={homeForRole(user.role)} replace />;
  return children;
}
