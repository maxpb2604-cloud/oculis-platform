#!/bin/bash
#
# Oculis data refresh — THE single scheduled driver for all recurring ingestion.
# Runs, in order:
#   daily       chamber activity + deposits (live scrape of both chambers)
#   regulatory  regulatory consultations (MISPAS, PROCONSUMIDOR, INDOTEL, ...)
#   feed        news/social/legislative feed rebuild
#
# Cost-safe: forces the OFFLINE heuristic categorizer/scorer. Note the worker's
# env.ts re-fills UNSET vars from app/.env ("existing process.env values win"),
# so we must EXPORT an override — unsetting would silently re-enable Claude.
#
# Invoked by launchd agent com.oculis.feed-refresh (6×/day, calendar-based so
# missed runs catch up after sleep). Manual run: `bash scripts/refresh-feed.sh`.
# The weekly roster refresh stays separate (com.fhc.monitoring.roster, Mon 04:30).
set -uo pipefail

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DATABASE_URL="${DATABASE_URL:-postgres://emilpenabautista@localhost:5433/oculis}"
# Force the offline path (export beats .env; see env.ts loadEnv semantics above).
export OCULIS_USE_CLAUDE=0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/refresh-feed.log"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
echo "[$(ts)] ▶ refresh start" >>"$LOG"

# If the managed local Postgres (:5433) is down (e.g. after a reboot), start it.
ensure_pg() {
  case "$DATABASE_URL" in
    *localhost:5433*|*127.0.0.1:5433*) ;;
    *) return 0 ;;  # not the locally managed cluster; leave it alone
  esac
  local PGCTL="/usr/local/opt/postgresql@16/bin/pg_ctl"
  local PGDATA="$ROOT/.pgdata"
  if [ ! -x "$PGCTL" ] || [ ! -d "$PGDATA" ]; then
    echo "[$(ts)] ⚠ pg_ctl/.pgdata missing — skipping Postgres autostart" >>"$LOG"; return 0
  fi
  if ! "$PGCTL" status -D "$PGDATA" >/dev/null 2>&1; then
    echo "[$(ts)] ▶ postgres down — starting cluster :5433" >>"$LOG"
    "$PGCTL" -D "$PGDATA" -o "-p 5433 -k /tmp" -l "$PGDATA/server.log" start >>"$LOG" 2>&1 \
      && { sleep 2; echo "[$(ts)] ✔ postgres up" >>"$LOG"; } \
      || echo "[$(ts)] ✖ postgres failed to start — ingestion will fail to connect" >>"$LOG"
  fi
}
ensure_pg

cd "$ROOT/apps/worker" || { echo "[$(ts)] ✖ worker dir missing" >>"$LOG"; exit 1; }

npm run daily      >>"$LOG" 2>&1 && echo "[$(ts)] ✔ daily ok"      >>"$LOG" || echo "[$(ts)] ✖ daily failed"      >>"$LOG"
npm run regulatory >>"$LOG" 2>&1 && echo "[$(ts)] ✔ regulatory ok" >>"$LOG" || echo "[$(ts)] ✖ regulatory failed" >>"$LOG"
npm run feed       >>"$LOG" 2>&1 && echo "[$(ts)] ✔ feed ok"       >>"$LOG" || echo "[$(ts)] ✖ feed failed"       >>"$LOG"

echo "[$(ts)] ◼ refresh done" >>"$LOG"
