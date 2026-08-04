/**
 * MediSync — Express application setup: middleware, API routes, static SPA
 * serving, and error handling. The HTTP server itself is started in server.js.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const authRoutes = require('./routes/auth');
const locationRoutes = require('./routes/locations');
const notificationRoutes = require('./routes/notifications');
const doctorRoutes = require('./routes/doctors');
const doctorReportRoutes = require('./routes/doctor-reports');
const doctorPortalRoutes = require('./routes/doctor-portal');
const appointmentRoutes = require('./routes/appointments');
const patientRoutes = require('./routes/patients');
const adminReportRoutes = require('./routes/admin-reports');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple request logger (skipped in test env).
if (process.env.NODE_ENV !== 'test') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });
}

// Health check (useful for hosting platforms / load balancers).
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// API routes.
//
// Order matters: the report routers sit under prefixes their portal router
// already owns, so /api/doctor/reports and /api/admin/reports must be mounted
// BEFORE /api/doctor and /api/admin. Mounted the other way round, the portal
// router matches first and answers "not found" for every report.
app.use('/api/auth', authRoutes);
app.use('/api/locations', locationRoutes);           // public site list
app.use('/api/notifications', notificationRoutes);   // tray, any signed-in role
app.use('/api/doctors', doctorRoutes);               // public directory (browse/book)
app.use('/api/doctor/reports', doctorReportRoutes);  // physician's own data only
app.use('/api/doctor', doctorPortalRoutes);          // physician's own portal
app.use('/api/appointments', appointmentRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/admin/reports', adminReportRoutes);    // clinic-wide reporting
app.use('/api/admin', adminRoutes);

// Unknown API route -> JSON 404 (before SPA fallthrough).
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---------------------------------------------------------------------------
// Frontend: serve the built React app (client/dist) with an SPA fallback so
// client-side routes like /app/doctors work on refresh/deep-link.
// In development, run the Vite dev server instead (npm run dev:client).
// ---------------------------------------------------------------------------
const distDir = path.join(__dirname, '..', 'client', 'dist');
const indexHtml = path.join(distDir, 'index.html');

app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  if (!fs.existsSync(indexHtml)) {
    return res
      .status(503)
      .type('text')
      .send('Frontend not built yet. Run "npm run build" (or use the Vite dev server: npm run dev:client).');
  }
  return res.sendFile(indexHtml);
});

// Centralized error handler.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = app;
