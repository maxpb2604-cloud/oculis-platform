#!/bin/bash
# FHC roster — runner canónico para launchd y ejecución manual.
#   roster = --roster  (190 diputados + 32 senadores por provincia + composición de comisiones)
#
# El roster cambia poco (juramentaciones, recomposición de comisiones), por eso corre
# SEMANAL — separado del daily, que es de alta frecuencia. La ingesta tarda ~2-3 min.
#
# Uso manual:  bash scripts/roster-run.sh
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
cd "$APP_DIR"
# node/postgres en el PATH cuando launchd corre sin shell interactivo (Mac Intel: /usr/local/bin)
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

LOG_DIR="$APP_DIR/.data/logs"; mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/roster-$(date +%Y-%m-%d).log"
log() { echo "$@" >> "$LOG"; }

# El worker carga .env por su cuenta (apps/worker/src/env.ts -> loadEnv).

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
  npx tsx apps/worker/src/index.ts "${@:2}" >> "$LOG" 2>&1 \
    || log "!! $1 terminó con error"
}

log "===== FHC roster run · $(date) ====="
ensure_pg
run "roster" --roster
log "===== fin · $(date) ====="
