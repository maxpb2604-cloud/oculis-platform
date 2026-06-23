#!/bin/bash
# FHC daily monitoring — legislativo (--daily) + regulatorio. Runner para launchd.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
LOG_DIR="$APP_DIR/.data/logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/daily-$(date +%Y-%m-%d).log"
run() {
  echo "--- $1 · $(date '+%H:%M:%S') ---" >> "$LOG"
  npx tsx --env-file=.env apps/worker/src/index.ts "${@:2}" >> "$LOG" 2>&1 \
    || echo "!! $1 termino con error" >> "$LOG"
}
echo "===== FHC daily run · $(date) =====" >> "$LOG"
run "legislativo" --daily
run "regulatorio" --regulatory
echo "===== fin · $(date) =====" >> "$LOG"
