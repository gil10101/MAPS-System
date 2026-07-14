/**
 * Database connection + initialization.
 *
 * Uses better-sqlite3 (synchronous SQLite driver). The database file is
 * created on first run and the schema is applied automatically, so a fresh
 * clone works with no manual DB setup.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || 'data/maps.db';
const absDbPath = path.isAbsolute(DB_PATH)
  ? DB_PATH
  : path.join(__dirname, '..', '..', DB_PATH);

// Ensure the containing directory exists (e.g. ./data)
fs.mkdirSync(path.dirname(absDbPath), { recursive: true });

const db = new Database(absDbPath);

// Recommended pragmas for a small web app
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * Apply the schema. Safe to call on every startup (all statements use
 * IF NOT EXISTS).
 */
function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

initSchema();

module.exports = db;
