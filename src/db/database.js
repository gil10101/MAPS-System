/**
 * Database layer — PostgreSQL via node-postgres (pg).
 *
 * The connection string comes from DATABASE_URL (e.g. a Neon connection
 * string). SSL is enabled automatically for remote hosts and disabled for
 * localhost, so the same code works against Neon and a local Postgres.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings (not JS Date objects) so
// date comparisons and JSON responses stay timezone-safe.
types.setTypeParser(1082, (v) => v);
// Return BIGINT (e.g. COUNT(*)) as a number instead of a string.
types.setTypeParser(20, (v) => parseInt(v, 10));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Create a free Postgres database at https://neon.tech, then put its\n' +
      'connection string in .env (see .env.example).'
  );
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});

/** Run a query, return all rows. */
async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

/** Run a query, return the first row (or null). */
async function one(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

/**
 * Run `fn(client)` inside a transaction. Rolls back on any thrown error.
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Apply the schema. Idempotent (IF NOT EXISTS everywhere). */
async function init() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

module.exports = { pool, query, one, tx, init };
