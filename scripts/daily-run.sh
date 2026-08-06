#!/bin/bash
# FHC daily monitoring — runner canónico para launchd y ejecución manual.
#   legislativo  = --daily  (depósitos del día + movimientos en comisiones / pleno)
#   regulatorio  = --regulatory
# Uso manual:  bash scripts/daily-run.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"
# node/postgres en el PATH cuando launchd corre sin shell interactivo (Mac Intel: /usr/local/bin)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export OCULIS_ENV="production"

LOG_DIR="$APP_DIR/.data/logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/daily-$(date +%Y-%m-%d).log"
log() { echo "$@" >> "$LOG"; }

# El worker carga .env por su cuenta (apps/worker/src/env.ts -> loadEnv), por eso NO usamos
# `node --env-file`: era redundante y rompía el run con "node: .env: not found".

# Si DATABASE_URL apunta al cluster local :5433 y está caído, lo levantamos (sobrevive reinicios).
ensure_pg() {
  local url; url="$(sed -nE 's/^DATABASE_URL=//p' "$APP_DIR/.env" 2>/dev/null | head -1)"
  case "$url" in
    *localhost:5433*|*127.0.0.1:5433*) ;;
    *) return 0 ;;  # no es el cluster local administrado por nosotros; no tocamos nada
  esac
  local PGCTL="/usr/local/opt/postgresql@16/bin/pg_ctl"
  local PGDATA="$APP_DIR/.pgdata"
  if [ ! -x "$PGCTL" ] || [ ! -d "$PGDATA" ]; then
    log "!! pg_ctl o .pgdata no encontrados; omito arranque de Postgres"; return 0
  fi
  if "$PGCTL" status -D "$PGDATA" >/dev/null 2>&1; then
    log "postgres ya está arriba (:5433)"
  else
    log "postgres caído; arrancando cluster :5433..."
    if "$PGCTL" -D "$PGDATA" -o "-p 5433 -k /tmp" -l "$PGDATA/server.log" start >> "$LOG" 2>&1; then
      sleep 2; log "postgres arrancado"
    else
      log "!! no pude arrancar postgres; el worker probablemente fallará la conexión"
    fi
  fi
}

run() {
  log "--- $1 · $(date '+%H:%M:%S') ---"
  if npx --no-install tsx apps/worker/src/index.ts "${@:2}" >> "$LOG" 2>&1; then
    log "OK: $1"
  else
    local status=$?
    log "ERROR: $1 terminó con código $status"
    return "$status"
  fi
}

log "===== FHC daily run · $(date) ====="
ensure_pg
failures=0
run "legislativo" --daily || failures=$((failures + 1))
run "regulatorio" --regulatory || failures=$((failures + 1))
log "===== fin · $(date) · fallos=$failures ====="
if [ "$failures" -gt 0 ]; then exit 1; fi
