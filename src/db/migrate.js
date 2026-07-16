/**
 * Migration runner.
 *
 *   npm run migrate                  # apply every pending migration in order
 *   npm run migrate -- --rollback 001  # run a specific rollback script
 *   npm run migrate -- --status      # list applied vs pending, change nothing
 *
 * Applied migrations are recorded in schema_migrations so re-running is a
 * no-op. Each file runs inside its own transaction (the SQL carries its own
 * BEGIN/COMMIT), so a failure leaves the database on the last good version.
 */
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('./database');

const DIR = path.join(__dirname, 'migrations');

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/** Migration files, excluding rollbacks, sorted by their numeric prefix. */
function migrationFiles() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.sql') && !f.includes('rollback'))
    .sort();
}

const versionOf = (file) => file.split('_')[0];

async function appliedVersions() {
  const rows = await db.query('SELECT version FROM schema_migrations');
  return new Set(rows.map((r) => r.version));
}

async function status() {
  const applied = await appliedVersions();
  const files = migrationFiles();
  if (!files.length) return console.log('No migrations found.');
  console.log('\nMigrations:');
  for (const f of files) {
    console.log(`  ${applied.has(versionOf(f)) ? '[applied]' : '[pending]'} ${f}`);
  }
  console.log('');
}

async function up() {
  const applied = await appliedVersions();
  const pending = migrationFiles().filter((f) => !applied.has(versionOf(f)));

  if (!pending.length) {
    console.log('Database is up to date — nothing to apply.');
    return;
  }

  for (const file of pending) {
    const version = versionOf(file);
    process.stdout.write(`Applying ${file} … `);
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      console.log('ok');
    } catch (err) {
      console.log('FAILED');
      console.error(`\n${file} failed: ${err.message}`);
      console.error('The transaction rolled back; the database is unchanged by this file.');
      process.exitCode = 1;
      return;
    }
  }
  console.log(`\nApplied ${pending.length} migration(s).`);
}

async function down(version) {
  const file = path.join(DIR, `${version}_rollback.sql`);
  if (!fs.existsSync(file)) {
    console.error(`No rollback script for version ${version} (expected ${file}).`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Rolling back ${version} … `);
  try {
    await db.query(fs.readFileSync(file, 'utf8'));
    await db.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    console.error(`\nRollback failed: ${err.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  await ensureTable();

  if (args.includes('--status')) return status();

  const i = args.indexOf('--rollback');
  if (i !== -1) {
    const version = args[i + 1];
    if (!version) {
      console.error('Usage: npm run migrate -- --rollback <version>   e.g. 001');
      process.exitCode = 1;
      return;
    }
    return down(version);
  }
  return up();
}

main()
  .catch((err) => {
    console.error('Migration error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
