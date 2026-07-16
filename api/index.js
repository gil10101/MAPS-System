/**
 * Vercel serverless entry point.
 *
 * Vercel routes every /api/* request here (see vercel.json) and the Express app
 * matches on the original URL, so the route mounts in src/app.js are unchanged.
 *
 * The schema is applied out-of-band (npm run seed) rather than here: a
 * serverless function runs per-request and must not re-apply DDL on cold start.
 */
'use strict';

const app = require('../src/app');

module.exports = app;
