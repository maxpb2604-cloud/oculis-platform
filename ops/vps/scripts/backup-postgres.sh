#!/usr/bin/env bash
set -euo pipefail

backup_dir="${OCULIS_BACKUP_DIR:-/var/backups/oculis/postgresql}"
retention_days="${OCULIS_BACKUP_RETENTION_DAYS:-14}"

for required in PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD; do
  if [[ -z "${!required:-}" ]]; then
    echo "$required is required for PostgreSQL backups" >&2
    exit 78
  fi
done
if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 )); then
  echo "OCULIS_BACKUP_RETENTION_DAYS must be a positive integer" >&2
  exit 78
fi

umask 0077
mkdir -p "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
if ! flock -w 60 9; then
  echo "another PostgreSQL backup is already running" >&2
  exit 75
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$backup_dir/oculis-$timestamp.dump"
temporary="$backup_dir/.oculis-$timestamp.dump.tmp"
trap 'rm -f -- "$temporary"' EXIT

# libpq reads PG* variables from the protected environment file; no password is
# exposed in the process command line.
pg_dump \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file="$temporary"

# A successful list pass catches truncated or structurally invalid custom dumps.
pg_restore --list "$temporary" >/dev/null
mv -- "$temporary" "$final"
sha256sum "$final" >"$final.sha256"
trap - EXIT

echo "verified PostgreSQL backup: $final"

find "$backup_dir" -mindepth 1 -maxdepth 1 -type f -name 'oculis-*.dump' \
  -mtime "+$retention_days" -print0 | while IFS= read -r -d '' old_dump; do
    rm -f -- "$old_dump" "$old_dump.sha256"
  done

if [[ -n "${RESTIC_REPOSITORY:-}" ]]; then
  if ! command -v restic >/dev/null 2>&1; then
    echo "RESTIC_REPOSITORY is configured but restic is not installed" >&2
    exit 69
  fi
  restic backup "$final" "$final.sha256"
  restic forget --keep-daily "$retention_days" --keep-weekly 8 --keep-monthly 12 --prune
fi
