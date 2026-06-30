#!/bin/bash
#
# Live data refresh for the Oculis feed. Scrapes chamber activity + deposits
# (`daily`) and rebuilds the news/social/legislative feed (`feed`), writing to
# the local Postgres. Runs the OFFLINE heuristic categorizer/scorer — it does
# NOT set OCULIS_USE_CLAUDE, so it never needs Anthropic API credits.
#
# Invoked by the launchd agent com.oculis.feed-refresh (every few hours) and can
# also be run by hand: `bash scripts/refresh-feed.sh`.
set -uo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DATABASE_URL="${DATABASE_URL:-postgres://emilpenabautista@localhost:5433/oculis}"
# Force the offline path regardless of any shell profile that exports these.
unset OCULIS_USE_CLAUDE ANTHROPIC_API_KEY

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/refresh-feed.log"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
echo "[$(ts)] ▶ refresh start" >>"$LOG"

cd "$ROOT/apps/worker" || { echo "[$(ts)] ✖ worker dir missing" >>"$LOG"; exit 1; }

# Chamber activity + deposits (live scrape), then the feed (news + signals).
npm run daily >>"$LOG" 2>&1 && echo "[$(ts)] ✔ daily ok" >>"$LOG" || echo "[$(ts)] ✖ daily failed" >>"$LOG"
npm run feed  >>"$LOG" 2>&1 && echo "[$(ts)] ✔ feed ok"  >>"$LOG" || echo "[$(ts)] ✖ feed failed"  >>"$LOG"

echo "[$(ts)] ◼ refresh done" >>"$LOG"
