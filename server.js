/**
 * Server entry point for the MAPS (Medical Appointment and Patient Scheduling)
 * system. Loads environment config, initializes the database, and starts the
 * HTTP server.
 */
'use strict';

require('dotenv').config();

const app = require('./src/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('==================================================');
  console.log('  MAPS - Medical Appointment & Patient Scheduling');
  console.log('==================================================');
  console.log(`  Server running:  http://localhost:${PORT}`);
  console.log(`  Environment:     ${process.env.NODE_ENV || 'development'}`);
  console.log('  Press Ctrl+C to stop.');
  console.log('==================================================');
});
