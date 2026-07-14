/**
 * Authentication + authorization middleware (JWT based).
 */
'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/** Sign a token for a given user record. */
function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Require a valid bearer token. Attaches the decoded payload to req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
  }
}

/**
 * Require the authenticated user to have one of the given roles.
 * Use after requireAuth.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that.' });
    }
    return next();
  };
}

module.exports = { signToken, requireAuth, requireRole, JWT_SECRET };
