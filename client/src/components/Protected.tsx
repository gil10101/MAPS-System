/**
 * Route guard for a portal.
 *
 * No token or no cached user means the visitor is signed out, so they go to
 * /login. A signed-in user on the wrong portal is a different problem: bouncing
 * them to /login would look like their session had expired, so they are sent to
 * their own home instead.
 *
 * This is convenience, not security — the cached user is client-side state a
 * determined visitor can edit. Every endpoint behind these routes authorises
 * the JWT for itself.
 */
import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getToken, getUser, homeFor, type Role } from '../lib/api';

export default function Protected({ role, children }: { role: Role; children: ReactNode }) {
  const user = getUser();
  if (!getToken() || !user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}
