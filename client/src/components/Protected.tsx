import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getToken, getUser, homeFor, type Role } from '../lib/api';

/**
 * Route guard: requires a logged-in user with the given role.
 * Unauthenticated -> /login; wrong role -> that role's home.
 */
export default function Protected({ role, children }: { role: Role; children: ReactNode }) {
  const user = getUser();
  if (!getToken() || !user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}
