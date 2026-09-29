#!/usr/bin/env bash
set -euo pipefail

app_dir="${OCULIS_APP_DIR:-/opt/oculis/current}"
result_root="${OCULIS_SOURCE_HEALTH_DIR:-/var/lib/oculis/health/live-source}"
run_id="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="$result_root/$run_id"

cd "$app_dir"
mkdir -p "$run_dir"

# These tests are deliberately isolated from application data and credentials.
export CI=true
export OCULIS_LIVE=1
export DATABASE_URL=""
export OCULIS_AUTO_MIGRATE=0

set +e
npm run test:live -w @oculis/scrapers -- \
  --no-file-parallelism \
  --maxWorkers=1 \
  --cache=false \
  --reporter=default \
  --reporter=junit \
  --outputFile.junit="$run_dir/vitest.junit.xml" \
  2>&1 | tee "$run_dir/vitest.log"
status=${PIPESTATUS[0]}
set -e

printf '%s\n' "$status" >"$run_dir/exit-status"
ln -sfn "$run_dir" "$result_root/latest"

# Retain detailed evidence for 30 days.
find "$result_root" -mindepth 1 -maxdepth 1 -type d -mtime +30 -print0 | \
  while IFS= read -r -d '' old_run; do
    rm -rf -- "$old_run"
  done

exit "$status"
