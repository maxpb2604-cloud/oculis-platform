#!/bin/bash
# FHC daily monitoring run — both chambers. Invoked by launchd (see
# scripts/com.fhc.monitoring.daily.plist) or by hand: `bash scripts/daily.sh`.
set -euo pipefail

# Resolve repo root (this script lives in <repo>/scripts)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"

# Make sure Homebrew/node are on PATH when run headless by launchd
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LOG_DIR="$APP_DIR/.data/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%d)"

echo "=== FHC daily run $(date) ===" >> "$LOG_DIR/daily-$STAMP.log"
npx tsx --env-file=.env apps/worker/src/index.ts --daily >> "$LOG_DIR/daily-$STAMP.log" 2>&1
echo "=== done $(date) ===" >> "$LOG_DIR/daily-$STAMP.log"
