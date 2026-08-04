#!/bin/bash
# Reseed the MediSync demo database on the morning of the demonstration.
#
# Appointment dates are computed relative to the moment the seed runs, so the
# book has to be rebuilt on the day it is presented: "today's clinic", the
# pending approval queue, and the reports all hang off the current date.
#
# Scheduled by ~/Library/LaunchAgents/com.medisync.demo-reseed.plist. Reads
# DATABASE_URL from the repo's .env, which is why this runs locally rather than
# in a cloud agent — the connection string never leaves the machine.
set -euo pipefail

REPO="/Users/gil/Stuff/MAPS-System"
NODE="/Users/gil/.nvm/versions/node/v25.2.1/bin/node"
LOG="$REPO/scripts/demo-reseed.log"

{
  echo "=============================================================="
  echo "MediSync demo reseed — $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "=============================================================="

  cd "$REPO"

  if [ ! -f .env ]; then
    echo "FAILED: no .env in $REPO — DATABASE_URL is unavailable."
    exit 1
  fi

  "$NODE" src/db/seed.js --reset

  # Confirm the book actually lands on today, since that is the whole point of
  # running this at all. A seed that succeeds but dates everything to last week
  # would otherwise look fine in the log. Uses the application's own database
  # module so the connection settings stay defined in exactly one place.
  "$NODE" -e '
    require("dotenv").config();
    const db = require("./src/db/database");
    db.one(`
      SELECT count(*) FILTER (WHERE appt_date = CURRENT_DATE) AS today,
             count(*) FILTER (WHERE status = $$pending$$)     AS pending,
             min(appt_date) AS first,
             max(appt_date) AS last
        FROM appointments
    `).then((r) => {
      console.log(`window ${r.first} -> ${r.last}`);
      console.log(`today: ${r.today} appointments | awaiting approval: ${r.pending}`);
      if (Number(r.today) === 0) {
        console.error("WARNING: no appointments dated today — check the seed window.");
        process.exit(1);
      }
      console.log("Demo data is ready.");
      return db.pool.end();
    }).catch((e) => { console.error("verification failed:", e.message); process.exit(1); });
  '

  echo "Done at $(date '+%H:%M:%S')."
  echo ""
} >> "$LOG" 2>&1

# One-shot: stop the job re-firing on this date in future years.
launchctl bootout "gui/$(id -u)/com.medisync.demo-reseed" 2>/dev/null || true
