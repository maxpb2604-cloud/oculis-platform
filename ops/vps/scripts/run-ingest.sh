#!/usr/bin/env bash
set -uo pipefail

mode="${1:-}"
lock_dir="${OCULIS_LOCK_DIR:-/var/lib/oculis/locks}"
lock_wait="${OCULIS_INGEST_LOCK_WAIT_SECONDS:-21600}"

if [[ -z "$mode" ]]; then
  echo "usage: $0 {frequent|maintenance|roster|weekly|regulatory}" >&2
  exit 64
fi
case "$mode" in
  frequent|maintenance|roster|weekly|regulatory) ;;
  *)
    echo "unsupported ingestion mode: $mode" >&2
    exit 64
    ;;
esac
if [[ -z "${DATABASE_URL:-}" || "$DATABASE_URL" != postgresql://* ]]; then
  echo "DATABASE_URL must point to persistent PostgreSQL" >&2
  exit 78
fi
if [[ ! "$lock_wait" =~ ^[0-9]+$ ]]; then
  echo "OCULIS_INGEST_LOCK_WAIT_SECONDS must be an integer" >&2
  exit 78
fi

# Acquire the writer lock before resolving the mutable `current` symlink. This
# guarantees that a worker either uses the fully accepted old release or the fully
# accepted new one, never old code against a newly bootstrapped schema.
if [[ ! -d "$lock_dir" || -L "$lock_dir" || \
  "$(stat -c '%u' "$lock_dir")" != "0" ]] || \
  (( (8#$(stat -c '%a' "$lock_dir") & 022) != 0 )); then
  echo "trusted ingestion lock directory is unavailable: $lock_dir" >&2
  exit 78
fi
if [[ ! -f "$lock_dir/ingestion.lock" || -L "$lock_dir/ingestion.lock" ]]; then
  echo "trusted ingestion lock is unavailable: $lock_dir/ingestion.lock" >&2
  exit 78
fi
if [[ "$(stat -c '%u' "$lock_dir/ingestion.lock")" != "$EUID" || \
  "$(stat -c '%g' "$lock_dir/ingestion.lock")" != "$(id -g)" || \
  "$(stat -c '%h' "$lock_dir/ingestion.lock")" != "1" || \
  "$(stat -c '%a' "$lock_dir/ingestion.lock")" != "660" ]]; then
  echo "trusted ingestion lock has unsafe ownership or links" >&2
  exit 78
fi
exec 9<>"$lock_dir/ingestion.lock"
if ! flock -w "$lock_wait" 9; then
  echo "timed out waiting for the global Oculis ingestion lock" >&2
  exit 75
fi
app_link="${OCULIS_APP_DIR:-/opt/oculis/current}"
app_dir="$(readlink -f "$app_link")"
if [[ -z "$app_dir" || ! -d "$app_dir" ]]; then
  echo "Oculis application release is unavailable: $app_link" >&2
  exit 69
fi
cd "$app_dir"

export NODE_ENV=production
export OCULIS_ENV=production
export OCULIS_AUTO_MIGRATE=0
export PATH="/usr/local/bin:/usr/bin:/bin"

failures=0

run_step() {
  local label="$1"
  shift
  echo "[$(date --iso-8601=seconds)] START $label"
  if "$@"; then
    echo "[$(date --iso-8601=seconds)] OK $label"
  else
    local status=$?
    echo "[$(date --iso-8601=seconds)] ERROR($status) $label" >&2
    failures=$((failures + 1))
  fi
}

case "$mode" in
  frequent)
    run_step "missing deposited document metadata" \
      npm run ingest -w @oculis/worker -- --documents --missing-deposited
    run_step "scheduled legislative monitoring" \
      npm run daily -w @oculis/worker
    run_step "changed initiative histories" \
      npm run movements:incremental -w @oculis/worker
    run_step "documents for recent movements" \
      npm run ingest -w @oculis/worker -- --documents --recent-status-days 45
    run_step "official PDF availability" \
      npm run verify-documents -w @oculis/worker -- --all
    ;;
  maintenance)
    run_step "recent initiative slices" \
      npm run crawl -w @oculis/worker
    run_step "changed initiative histories" \
      npm run movements:incremental -w @oculis/worker
    run_step "regulatory sources" \
      npm run ingest -w @oculis/worker -- --regulatory
    run_step "complete document metadata" \
      npm run ingest -w @oculis/worker -- --documents
    run_step "official PDF availability" \
      npm run verify-documents -w @oculis/worker -- --all
    run_step "recent congressional publications" \
      npm run publications -w @oculis/worker -- --limit 3
    ;;
  roster)
    run_step "congressional rosters" \
      npm run roster -w @oculis/worker
    ;;
  weekly)
    run_step "complete Diputados corpus" \
      npm run crawl:corpus -w @oculis/worker
    run_step "official Diputados histories" \
      npm run movements -w @oculis/worker
    run_step "complete Senate collection" \
      npm run senate:corpus -w @oculis/worker
    run_step "complete Senate Ficha evidence" \
      npm run senate:fichas:full -w @oculis/worker
    run_step "initiative proponents" \
      npm run link:initiative-proponents -w @oculis/worker
    run_step "complete document metadata" \
      npm run ingest -w @oculis/worker -- --documents
    run_step "official PDF availability" \
      npm run verify-documents -w @oculis/worker -- --all
    run_step "complete congressional publications" \
      npm run publications -w @oculis/worker -- --full
    ;;
  regulatory)
    run_step "regulatory sources" \
      npm run ingest -w @oculis/worker -- --regulatory
    ;;
esac

echo "[$(date --iso-8601=seconds)] DONE mode=$mode failures=$failures"
if (( failures > 0 )); then
  exit 1
fi
