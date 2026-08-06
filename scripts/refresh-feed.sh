#!/bin/bash
#
# Scheduled factual-data refresh for Oculis. `daily` collects chamber activity,
# deposits and source publications, then writes them to the configured database.
# It does not classify, score or infer legislative states.
#
# Invoked by the launchd agent com.oculis.feed-refresh (every few hours) and can
# also be run by hand: `bash scripts/refresh-feed.sh`.
set -uo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# Prevent an accidental in-memory database if `.env` does not provide a durable
# DATABASE_URL (or an explicitly configured DB_DRIVER=pglite/PGLITE_DIR pair).
export OCULIS_ENV="production"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/refresh-feed.log"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
echo "[$(ts)] ▶ refresh start" >>"$LOG"

cd "$ROOT/apps/worker" || { echo "[$(ts)] ✖ worker dir missing" >>"$LOG"; exit 1; }

# `daily` already includes activity, deposits and feed. Preserve its failure code
# so launchd/GitHub can never report a green refresh when a source failed.
if npm run daily >>"$LOG" 2>&1; then
  echo "[$(ts)] ✔ refresh done" >>"$LOG"
else
  status=$?
  echo "[$(ts)] ✖ refresh failed (exit $status)" >>"$LOG"
  exit "$status"
fi
