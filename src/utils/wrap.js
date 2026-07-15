/**
 * Wrap an async Express handler so rejected promises reach the centralized
 * error handler (Express 4 doesn't catch async errors on its own).
 */
'use strict';

module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
