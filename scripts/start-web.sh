#!/bin/bash
#
# Serve the Oculis web app in PRODUCTION mode on http://localhost:3000.
# Production mode pre-compiles every page, so first visits are fast (dev mode
# compiles each page on first visit — up to ~20s on this machine).
#
# Usage:
#   bash scripts/start-web.sh          # build if needed, then serve
#   bash scripts/start-web.sh --build  # force a fresh build, then serve
#
# Invoked by the launchd agent com.oculis.web (KeepAlive) so the platform is
# always up after login. Rebuild after pulling new code: run with --build.
set -uo pipefail

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/web.log"

ts() { date "+%Y-%m-%d %H:%M:%S"; }

# A dev server (or stale process) on :3000 blocks next start.
if lsof -ti :3000 >/dev/null 2>&1; then
  echo "[$(ts)] ⚠ port 3000 busy — killing existing listener" >>"$LOG"
  lsof -ti :3000 | xargs kill 2>/dev/null
  sleep 2
fi

cd "$WEB" || { echo "[$(ts)] ✖ web dir missing" >>"$LOG"; exit 1; }

# BUILD_ID only exists after a completed production build.
if [ "${1:-}" = "--build" ] || [ ! -f .next/BUILD_ID ]; then
  echo "[$(ts)] ▶ next build" >>"$LOG"
  npm run build >>"$LOG" 2>&1 || { echo "[$(ts)] ✖ build failed" >>"$LOG"; exit 1; }
  echo "[$(ts)] ✔ build ok" >>"$LOG"
fi

# Bind loopback only: next start's default (all interfaces) would expose the
# unauthenticated dashboard and the Senate-proxy API to the whole LAN.
echo "[$(ts)] ▶ next start 127.0.0.1:3000" >>"$LOG"
exec npm run start -- --hostname 127.0.0.1 >>"$LOG" 2>&1
