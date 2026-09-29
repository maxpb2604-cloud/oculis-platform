#!/usr/bin/env bash
set -Eeuo pipefail

git_ref="${1:-main}"
repository="${OCULIS_REPOSITORY:-https://github.com/maxpb2604-cloud/oculis-platform.git}"
deploy_root="${OCULIS_DEPLOY_ROOT:-/opt/oculis}"
env_file="${OCULIS_ENV_FILE:-/etc/oculis/web.env}"
build_user="${OCULIS_BUILD_USER:-oculis-build}"
keep_releases="${OCULIS_KEEP_RELEASES:-5}"
service_name="${OCULIS_WEB_SERVICE:-oculis-web.service}"
proxy_service_name="${OCULIS_PUBLIC_PROXY_SERVICE:-caddy.service}"
ingestion_lock_wait="${OCULIS_INGEST_LOCK_WAIT_SECONDS:-21600}"
deployment_phase="${OCULIS_DEPLOY_PHASE:-production}"
schema_mode="${OCULIS_SCHEMA_MODE:-verify}"
deploy_tests="${OCULIS_DEPLOY_TESTS:-0}"

if [[ -z "$git_ref" || "$git_ref" == -* || "$git_ref" =~ [[:space:]] ]]; then
  echo "git ref must be non-empty, contain no whitespace, and not begin with '-'" >&2
  exit 78
fi
if [[ -z "$repository" || "$repository" == -* || "$repository" == *$'\r'* || "$repository" == *$'\n'* ]]; then
  echo "OCULIS_REPOSITORY is invalid" >&2
  exit 78
fi
if [[ "$deploy_root" != /* || "$deploy_root" == "/" || "$deploy_root" =~ [[:space:]] ]]; then
  echo "OCULIS_DEPLOY_ROOT must be an absolute, non-root path without whitespace" >&2
  exit 78
fi
if [[ "$service_name" == -* || ! "$service_name" =~ ^[A-Za-z0-9_.@-]+\.service$ ]]; then
  echo "OCULIS_WEB_SERVICE must be a systemd .service unit name" >&2
  exit 78
fi
if [[ ! "$build_user" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  echo "OCULIS_BUILD_USER is invalid" >&2
  exit 78
fi
if [[ "$proxy_service_name" == -* || ! "$proxy_service_name" =~ ^[A-Za-z0-9_.@-]+\.service$ ]]; then
  echo "OCULIS_PUBLIC_PROXY_SERVICE must be a systemd .service unit name" >&2
  exit 78
fi
if [[ ! "$keep_releases" =~ ^[0-9]+$ ]] || (( keep_releases < 2 )); then
  echo "OCULIS_KEEP_RELEASES must be an integer of at least 2" >&2
  exit 78
fi
if [[ ! "$ingestion_lock_wait" =~ ^[0-9]+$ ]]; then
  echo "OCULIS_INGEST_LOCK_WAIT_SECONDS must be an integer" >&2
  exit 78
fi
case "$deployment_phase" in
  production|bootstrap-private) ;;
  *)
    echo "OCULIS_DEPLOY_PHASE must be production or bootstrap-private" >&2
    exit 78
    ;;
esac
case "$schema_mode" in
  verify|bootstrap-empty) ;;
  *)
    echo "OCULIS_SCHEMA_MODE must be verify or bootstrap-empty; automated schema changes are disabled" >&2
    exit 78
    ;;
esac
if [[ "$deploy_tests" != "0" && "$deploy_tests" != "1" ]]; then
  echo "OCULIS_DEPLOY_TESTS must be 0 or 1" >&2
  exit 78
fi
if (( EUID != 0 )); then
  echo "deploy-release.sh must be invoked by the trusted root wrapper" >&2
  exit 77
fi
for command_name in awk chmod chown cmp curl find flock getent git id install node npm readlink sha256sum stat; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "required command not found: $command_name" >&2
    exit 69
  }
done
if [[ ! -x /usr/sbin/runuser ]]; then
  echo "required command not found: /usr/sbin/runuser" >&2
  exit 69
fi

validate_runtime_env_file() {
  local path="$1"
  local metadata owner group mode links
  if [[ "$path" != /* || ! -f "$path" || -L "$path" || ! -r "$path" ]]; then
    echo "runtime environment must be a readable regular file, not a symlink: $path" >&2
    exit 78
  fi
  if ! metadata="$(stat -c '%u:%g:%a:%h' -- "$path")"; then
    echo "cannot inspect runtime environment: $path" >&2
    exit 78
  fi
  IFS=: read -r owner group mode links <<<"$metadata"
  if [[ "$owner" != "0" || "$group" != "0" || "$mode" != "600" || "$links" != "1" ]]; then
    echo "runtime environment must be root:root mode 0600 with exactly one hard link: $path" >&2
    exit 78
  fi
}

validate_runtime_env_file "$env_file"
if ! id -u "$build_user" >/dev/null 2>&1; then
  echo "dedicated build user is unavailable: $build_user" >&2
  exit 69
fi
build_home="$(getent passwd "$build_user" | awk -F: 'NR == 1 {print $6}')"
if [[ "$build_home" != /* || "$build_home" == "/" ]]; then
  echo "dedicated build user has an invalid home directory" >&2
  exit 69
fi
if ! node --input-type=module -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 9)) process.exit(1);
'; then
  echo "Node.js >=20.9 is required" >&2
  exit 69
fi
if [[ ! -x /usr/bin/systemctl ]]; then
  echo "required command not found: /usr/bin/systemctl" >&2
  exit 69
fi
if [[ "$deployment_phase" == "bootstrap-private" ]] && \
  /usr/bin/systemctl is-active --quiet "$proxy_service_name"; then
  echo "private bootstrap refused while the public proxy is active" >&2
  exit 77
fi
if [[ "$deployment_phase" == "bootstrap-private" ]]; then
  if ! /usr/bin/systemctl stop "$service_name"; then
    echo "private bootstrap could not stop the existing web service" >&2
    exit 77
  fi
  if /usr/bin/systemctl is-active --quiet "$service_name"; then
    echo "private bootstrap requires the existing web service to be stopped" >&2
    exit 77
  fi
  private_timer_units=(
    oculis-ingest-frequent.timer
    oculis-ingest-maintenance.timer
    oculis-ingest-roster.timer
    oculis-ingest-weekly.timer
    oculis-health.timer
    oculis-source-health.timer
    oculis-backup.timer
  )
  private_worker_units=(
    oculis-ingest@frequent.service
    oculis-ingest@maintenance.service
    oculis-ingest@roster.service
    oculis-ingest@weekly.service
    oculis-ingest@regulatory.service
    oculis-health.service
    oculis-source-health.service
    oculis-backup.service
  )
  for unit_name in "${private_timer_units[@]}"; do
    if /usr/bin/systemctl is-active --quiet "$unit_name" || \
      /usr/bin/systemctl is-enabled --quiet "$unit_name"; then
      echo "private bootstrap requires timer disabled and stopped: $unit_name" >&2
      exit 77
    fi
  done
  for unit_name in "${private_worker_units[@]}"; do
    if /usr/bin/systemctl is-active --quiet "$unit_name"; then
      echo "private bootstrap requires worker stopped: $unit_name" >&2
      exit 77
    fi
  done
fi

systemctl_command=(/usr/bin/systemctl)

# Read only explicitly public build variables. The environment file is never
# evaluated here, and no database/session/admin secret reaches npm lifecycle hooks.
read_public_env_value() {
  local name="$1"
  local value
  value="$(awk -v key="$name" '
    index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }
  ' "$env_file")"
  if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' && ${#value} -ge 2 ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

public_url="$(read_public_env_value OCULIS_PUBLIC_URL)"
mapbox_token="$(read_public_env_value NEXT_PUBLIC_MAPBOX_TOKEN)"
if ! OCULIS_URL_TO_VALIDATE="$public_url" node --input-type=module -e '
  const raw = process.env.OCULIS_URL_TO_VALIDATE || "";
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== "https:" || parsed.username || parsed.password ||
      parsed.pathname !== "/" || parsed.search || parsed.hash || raw !== parsed.origin
    ) process.exit(1);
  } catch { process.exit(1); }
'; then
  echo "OCULIS_PUBLIC_URL must be a canonical HTTPS origin without path, query, or fragment" >&2
  exit 78
fi

releases_dir="$deploy_root/releases"
current_link="$deploy_root/current"
lock_dir="/var/lib/oculis/locks"
state_dir="/var/lib/oculis-state"
release_env_file="$state_dir/release.env"
mkdir -p "$releases_dir" "$deploy_root/.deploy" "$lock_dir"
chown root:root "$deploy_root/.deploy"
chmod 0711 "$deploy_root/.deploy"
for protected_dir in "$lock_dir" "$state_dir"; do
  if [[ ! -d "$protected_dir" || -L "$protected_dir" ]]; then
    echo "protected Oculis directory is missing or unsafe: $protected_dir" >&2
    exit 78
  fi
  protected_owner="$(stat -c '%u' "$protected_dir")"
  protected_mode="$(stat -c '%a' "$protected_dir")"
  if [[ "$protected_owner" != "0" ]] || (( (8#$protected_mode & 022) != 0 )); then
    echo "protected Oculis directory must be root-owned and not writable by group/other: $protected_dir" >&2
    exit 78
  fi
done
if [[ ! -f "$lock_dir/ingestion.lock" || -L "$lock_dir/ingestion.lock" ]]; then
  echo "trusted ingestion lock is missing; reinstall the VPS directory layout" >&2
  exit 78
fi
if [[ "$(stat -c '%h' "$lock_dir/ingestion.lock")" != "1" ]]; then
  echo "trusted ingestion lock must have exactly one hard link" >&2
  exit 78
fi
if [[ "$(stat -c '%u' "$lock_dir/ingestion.lock")" != "$(id -u oculis)" || \
  "$(stat -c '%g' "$lock_dir/ingestion.lock")" != "$(id -g oculis)" || \
  "$(stat -c '%a' "$lock_dir/ingestion.lock")" != "660" ]]; then
  echo "trusted ingestion lock must be oculis:oculis mode 0660" >&2
  exit 78
fi
exec 9>"$deploy_root/.deploy/deploy.lock"
if ! flock -n 9; then
  echo "another Oculis deployment is already running" >&2
  exit 75
fi

incoming="$(mktemp -d "$deploy_root/.deploy/incoming.XXXXXXXX")"
build_db="$(mktemp -d "${TMPDIR:-/tmp}/oculis-build-db.XXXXXXXX")"
release_env_backup="$(mktemp "${TMPDIR:-/tmp}/oculis-release-env.XXXXXXXX")"
chown "$build_user" "$incoming" "$build_db"
cleanup() {
  if [[ -n "$incoming" ]]; then
    rm -rf -- "$incoming"
  fi
  rm -rf -- "$build_db"
  rm -f -- "$release_env_backup"
}
trap cleanup EXIT

echo "Fetching $repository at $git_ref"
/usr/sbin/runuser -u "$build_user" -- git -C "$incoming" init --quiet
/usr/sbin/runuser -u "$build_user" -- git -C "$incoming" remote add origin "$repository"
/usr/sbin/runuser -u "$build_user" -- git -C "$incoming" fetch --quiet --depth=1 origin "$git_ref"
/usr/sbin/runuser -u "$build_user" -- git -C "$incoming" checkout --quiet --detach FETCH_HEAD
commit="$(/usr/sbin/runuser -u "$build_user" -- git -C "$incoming" rev-parse HEAD)"
if [[ "$git_ref" =~ ^[0-9a-f]{40}$ && "$commit" != "$git_ref" ]]; then
  echo "fetched commit does not match the requested SHA" >&2
  exit 65
fi
release_id="${commit:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
release_path="$releases_dir/$release_id"
if [[ -e "$release_path" ]]; then
  echo "release identifier collision; retry the deployment" >&2
  exit 75
fi

clean_build_env=(
  /usr/sbin/runuser -u "$build_user" --
  /usr/bin/env -i
  "HOME=$build_home"
  "USER=$build_user"
  "LOGNAME=$build_user"
  "PATH=/usr/local/bin:/usr/bin:/bin"
  "CI=true"
  "NODE_ENV=production"
  "NPM_CONFIG_CACHE=$build_home/.npm"
  "OCULIS_PUBLIC_URL=$public_url"
  "NEXT_PUBLIC_MAPBOX_TOKEN=$mapbox_token"
)

echo "Installing exact locked dependencies for $commit"
# Production workers use tsx and source health uses Vitest, so devDependencies must
# remain present on the VPS even though NODE_ENV is production.
"${clean_build_env[@]}" npm --prefix "$incoming" ci --include=dev
for required_tool in tsx tsc vitest; do
  if [[ ! -x "$incoming/node_modules/.bin/$required_tool" ]]; then
    echo "required workspace tool was omitted by npm ci: $required_tool" >&2
    exit 70
  fi
done
"${clean_build_env[@]}" npm --prefix "$incoming" run check:factual
"${clean_build_env[@]}" npm --prefix "$incoming" run typecheck
if [[ "$deploy_tests" == "1" ]]; then
  "${clean_build_env[@]}" npm --prefix "$incoming" test
fi

# Build only against disposable PGlite. Production credentials are not present in
# this process or in any npm lifecycle hook.
"${clean_build_env[@]}" \
  DB_DRIVER=pglite \
  PGLITE_DIR="$build_db" \
  OCULIS_AUTO_MIGRATE=1 \
  npm --prefix "$incoming" run build -w @oculis/web

# Build account access ends here. Make the release immutable to the application,
# preserving executability, and reserve only Next's cache for runtime writes.
chown -hR root:oculis "$incoming"
find "$incoming" -xdev -type d -exec chmod 0750 {} +
find "$incoming" -xdev -type f -perm /111 -exec chmod 0750 {} +
find "$incoming" -xdev -type f ! -perm /111 -exec chmod 0640 {} +
for cache_parent in "$incoming/apps" "$incoming/apps/web" "$incoming/apps/web/.next"; do
  if [[ ! -d "$cache_parent" || -L "$cache_parent" ]]; then
    echo "release contains an unsafe Next.js cache parent: $cache_parent" >&2
    exit 65
  fi
done
rm -rf -- "$incoming/apps/web/.next/cache"
install -d -o oculis -g oculis -m 0750 "$incoming/apps/web/.next/cache"

# Only after dependencies, tests and build are complete may trusted runtime code
# receive the protected database/session configuration.
validate_runtime_env_file "$env_file"
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

if [[ -z "${DATABASE_URL:-}" || "$DATABASE_URL" != postgresql://* ]]; then
  echo "DATABASE_URL must point to persistent PostgreSQL" >&2
  exit 78
fi
session_secret="${OCULIS_SESSION_SECRET:-}"
if [[ "$session_secret" == REPLACE_* || ${#session_secret} -lt 32 ]]; then
  echo "OCULIS_SESSION_SECRET is missing or too short" >&2
  exit 78
fi
if [[ "${OCULIS_PUBLIC_URL:-}" != "$public_url" ]]; then
  echo "OCULIS_PUBLIC_URL could not be parsed consistently" >&2
  exit 78
fi
runtime_db_env=(
  /usr/sbin/runuser -u oculis --
  /usr/bin/env -i
  HOME=/var/lib/oculis/runtime
  USER=oculis
  LOGNAME=oculis
  PATH=/usr/local/bin:/usr/bin:/bin
  NODE_ENV=production
  OCULIS_ENV=production
  OCULIS_AUTO_MIGRATE=0
  "DATABASE_URL=$DATABASE_URL"
  "OCULIS_DB_APP_NAME=${OCULIS_DB_APP_NAME:-oculis-vps-deploy}"
  "PG_POOL_MAX=${PG_POOL_MAX:-5}"
  "OCULIS_MIN_READY_INITIATIVES=${OCULIS_MIN_READY_INITIATIVES:-}"
)
# Hold the ingestion lock from schema inspection through activation and all
# acceptance gates. Waiting workers resolve `current` only after this FD unlocks.
exec 8<>"$lock_dir/ingestion.lock"
if ! flock -w "$ingestion_lock_wait" 8; then
  echo "timed out waiting for the global Oculis ingestion lock" >&2
  exit 75
fi

old_release=""
if [[ -L "$current_link" ]]; then
  old_release="$(readlink -f "$current_link")"
fi
schema_files=(
  packages/db/src/schema.ts
  packages/db/src/client.ts
  apps/worker/src/bootstrap-schema.ts
  apps/worker/src/schema-bootstrap.ts
)
schema_changed=0
if [[ -n "$old_release" && -d "$old_release" ]]; then
  for schema_file in "${schema_files[@]}"; do
    if [[ ! -f "$old_release/$schema_file" ]] || \
      ! cmp -s "$old_release/$schema_file" "$incoming/$schema_file"; then
      schema_changed=1
      break
    fi
  done
fi
if (( schema_changed == 1 )) && [[ "$schema_mode" == "verify" ]]; then
  echo "schema-defining files changed; automated DDL is disabled pending transactional, versioned migrations" >&2
  echo "use a reviewed maintenance window with services stopped and a tested backup/restore plan" >&2
  exit 65
fi
schema_fingerprint="$({
  cd "$incoming"
  sha256sum "${schema_files[@]}"
} | sha256sum | awk '{print $1}')"

database_state="$("${runtime_db_env[@]}" node \
  "$incoming/ops/vps/scripts/check-database-content.mjs" --state)"
case "$schema_mode" in
  verify)
    if [[ "$database_state" != "initialized" ]]; then
      echo "database schema is empty; first deployment requires explicit bootstrap-empty" >&2
      exit 65
    fi
    ;;
  bootstrap-empty)
    if [[ "$database_state" != "empty" ]]; then
      echo "bootstrap-empty is allowed only when the Oculis schema is absent" >&2
      exit 65
    fi
    "${runtime_db_env[@]}" "$incoming/node_modules/.bin/tsx" \
      "$incoming/apps/worker/src/bootstrap-schema.ts"
    ;;
esac

database_content_ready=1
if ! "${runtime_db_env[@]}" node \
  "$incoming/ops/vps/scripts/check-database-content.mjs" --assert-content; then
  database_content_ready=0
  if [[ "$deployment_phase" == "production" ]]; then
    echo "production activation refused: essential database content is incomplete" >&2
    exit 65
  fi
  echo "private bootstrap has no accepted data; keep Caddy, DNS and health timers disabled" >&2
fi

release_metadata_temp="$(mktemp "$incoming/.oculis-release.XXXXXXXX")"
printf 'GITHUB_SHA=%s\nSCHEMA_MODE=%s\nSCHEMA_FINGERPRINT=%s\n' \
  "$commit" "$schema_mode" "$schema_fingerprint" >"$release_metadata_temp"
chown root:oculis "$release_metadata_temp"
chmod 0640 "$release_metadata_temp"
mv -Tf -- "$release_metadata_temp" "$incoming/.oculis-release"
mv -- "$incoming" "$release_path"
incoming=""

if [[ -e "$release_env_file" ]]; then
  if [[ ! -f "$release_env_file" || -L "$release_env_file" || \
    "$(stat -c '%u' "$release_env_file")" != "0" || \
    "$(stat -c '%h' "$release_env_file")" != "1" ]] || \
    (( (8#$(stat -c '%a' "$release_env_file") & 022) != 0 )); then
    echo "release environment state is unsafe: $release_env_file" >&2
    exit 78
  fi
  cp -- "$release_env_file" "$release_env_backup"
else
  : >"$release_env_backup"
fi

write_release_env() {
  local release_sha="$1"
  local temporary_state
  [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]] || return 64
  temporary_state="$(mktemp "$state_dir/.release.env.XXXXXXXX")"
  printf 'GITHUB_SHA=%s\n' "$release_sha" >"$temporary_state"
  chown root:root "$temporary_state"
  chmod 0644 "$temporary_state"
  mv -Tf -- "$temporary_state" "$release_env_file"
}

restore_release_env() {
  local temporary_state
  if [[ -s "$release_env_backup" ]]; then
    temporary_state="$(mktemp "$state_dir/.release.env.XXXXXXXX")"
    cp -- "$release_env_backup" "$temporary_state"
    chown root:root "$temporary_state"
    chmod 0644 "$temporary_state"
    mv -Tf -- "$temporary_state" "$release_env_file"
  else
    rm -f -- "$release_env_file"
  fi
}

activate_release() {
  local target="$1"
  local temporary_link="$deploy_root/.current.$$.new"
  ln -s -- "$target" "$temporary_link"
  mv -Tf -- "$temporary_link" "$current_link"
}

rollback() {
  echo "Deployment acceptance failed; rolling back" >&2
  if [[ -n "$old_release" && -d "$old_release" ]]; then
    activate_release "$old_release"
    restore_release_env
    if [[ "$deployment_phase" == "bootstrap-private" ]]; then
      "${systemctl_command[@]}" stop "$service_name" || true
    else
      "${systemctl_command[@]}" restart "$service_name" || true
    fi
  else
    unlink "$current_link" 2>/dev/null || true
    rm -f -- "$release_env_file"
    "${systemctl_command[@]}" stop "$service_name" || true
  fi
  exit 1
}

activation_started=0
deployment_accepted=0
abort_after_activation() {
  local signal_name="$1"
  echo "Deployment interrupted by $signal_name" >&2
  if (( activation_started == 1 && deployment_accepted == 0 )); then
    rollback
  fi
  exit 1
}
trap 'abort_after_activation HUP' HUP
trap 'abort_after_activation INT' INT
trap 'abort_after_activation TERM' TERM

activation_started=1
activate_release "$release_path"
write_release_env "$commit"
if ! "${systemctl_command[@]}" restart "$service_name"; then
  rollback
fi

healthy=0
for _attempt in {1..30}; do
  health_response="$(curl --silent --show-error --fail --max-time 5 \
    http://127.0.0.1:3000/api/health 2>/dev/null)" || health_response=""
  ready_response=""
  if [[ "$database_content_ready" == "1" ]]; then
    ready_response="$(curl --silent --show-error --fail --max-time 8 \
      http://127.0.0.1:3000/api/ready 2>/dev/null)" || ready_response=""
  fi
  if OCULIS_HEALTH_PAYLOAD="$health_response" \
    OCULIS_READY_PAYLOAD="$ready_response" \
    OCULIS_EXPECTED_RELEASE="$commit" \
    OCULIS_REQUIRE_READY="$database_content_ready" \
    node --input-type=module -e '
      try {
        const health = JSON.parse(process.env.OCULIS_HEALTH_PAYLOAD || "null");
        if (
          health?.status !== "ok" || health?.service !== "oculis-web" ||
          health?.release !== process.env.OCULIS_EXPECTED_RELEASE
        ) process.exit(1);
        if (process.env.OCULIS_REQUIRE_READY === "1") {
          const ready = JSON.parse(process.env.OCULIS_READY_PAYLOAD || "null");
          if (
            ready?.status !== "ready" || ready?.service !== "oculis-web" ||
            ready?.database !== "postgresql"
          ) process.exit(1);
        }
      } catch { process.exit(1); }
    '; then
    healthy=1
    break
  fi
  sleep 2
done
if (( healthy == 0 )); then
  rollback
fi

# A private release is staged for schema/data transfer, not served. It is started
# briefly above only to validate the selected code and local liveness/readiness. Stop
# it before releasing the writer lock so the migrator has exclusive database access.
if [[ "$deployment_phase" == "bootstrap-private" ]]; then
  if ! "${systemctl_command[@]}" stop "$service_name"; then
    echo "private deployment validated, but the web service could not be stopped" >&2
    rollback
  fi
  if /usr/bin/systemctl is-active --quiet "$service_name"; then
    echo "private deployment refused to return while the web service is active" >&2
    rollback
  fi
fi

# Unlock only after production is accepted and serving, or private staging is
# accepted and confirmed stopped.
deployment_accepted=1
trap - HUP INT TERM
flock -u 8

if [[ "$database_content_ready" == "1" && "$deployment_phase" == "production" ]]; then
  deployment_state="production-ready"
else
  deployment_state="private-bootstrap-not-public"
fi
echo "Release $release_id accepted ($deployment_state)"

mapfile -t release_paths < <(
  find "$releases_dir" -mindepth 1 -maxdepth 1 -type d \
    -name '[0-9a-f][0-9a-f]*-[0-9]*T[0-9]*Z' -printf '%T@ %p\n' | \
    sort -rn | cut -d' ' -f2-
)
for ((index = keep_releases; index < ${#release_paths[@]}; index++)); do
  stale="${release_paths[$index]}"
  [[ "$stale" == "$releases_dir/"* ]] || continue
  [[ "$stale" == "$old_release" ]] && continue
  rm -rf -- "$stale"
done

printf 'deployed_commit=%s\nrelease=%s\nprevious=%s\nstate=%s\n' \
  "$commit" "$release_path" "${old_release:-none}" "$deployment_state"
