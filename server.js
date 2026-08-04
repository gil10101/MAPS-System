/**
 * Server entry point for MediSync (Medical Appointment and Patient Scheduling).
 * Loads environment config, initializes the database schema, and starts the
 * HTTP server.
 */
'use strict';

require('dotenv').config();

const db = require('./src/db/database');
const app = require('./src/app');

const PORT = process.env.PORT || 3000;

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log('======================================================');
      console.log('  MediSync - Medical Appointment & Patient Scheduling');
      console.log('======================================================');
      console.log(`  Server running:  http://localhost:${PORT}`);
      console.log(`  Environment:     ${process.env.NODE_ENV || 'development'}`);
      console.log('  Press Ctrl+C to stop.');
      console.log('======================================================');
    });
  })
  .catch((err) => {
    console.error('Failed to initialize the database:', err.message);
    console.error('Check that DATABASE_URL in .env points to a reachable Postgres instance.');
    process.exit(1);
  });
