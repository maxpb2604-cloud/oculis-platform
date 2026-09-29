#!/usr/bin/env bash
set -Eeuo pipefail

target_sha="${1:-}"
deploy_root="${OCULIS_DEPLOY_ROOT:-/opt/oculis}"
env_file="${OCULIS_ENV_FILE:-/etc/oculis/web.env}"
service_name="${OCULIS_WEB_SERVICE:-oculis-web.service}"
ingestion_lock_wait="${OCULIS_INGEST_LOCK_WAIT_SECONDS:-21600}"

if [[ ! "$target_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: rollback-release.sh FULL_40_CHARACTER_GIT_SHA" >&2
  exit 64
fi
if (( EUID != 0 )); then
  echo "rollback-release.sh must be invoked by the trusted root wrapper" >&2
  exit 77
fi
if [[ "$deploy_root" != /* || "$deploy_root" == "/" || "$deploy_root" =~ [[:space:]] ]]; then
  echo "OCULIS_DEPLOY_ROOT is invalid" >&2
  exit 78
fi
if [[ "$service_name" == -* || ! "$service_name" =~ ^[A-Za-z0-9_.@-]+\.service$ ]]; then
  echo "OCULIS_WEB_SERVICE must be a systemd .service unit name" >&2
  exit 78
fi
if [[ ! "$ingestion_lock_wait" =~ ^[0-9]+$ ]]; then
  echo "OCULIS_INGEST_LOCK_WAIT_SECONDS must be an integer" >&2
  exit 78
fi
for command_name in chmod chown curl flock id node readlink stat; do
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
if ! node --input-type=module -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 9)) process.exit(1);
'; then
  echo "Node.js >=20.9 is required" >&2
  exit 69
fi

systemctl_command=(/usr/bin/systemctl)

releases_dir="$deploy_root/releases"
current_link="$deploy_root/current"
lock_dir="/var/lib/oculis/locks"
state_dir="/var/lib/oculis-state"
release_env_file="$state_dir/release.env"
mkdir -p "$deploy_root/.deploy" "$lock_dir"
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
  echo "another Oculis deployment or rollback is already running" >&2
  exit 75
fi

exec 8<>"$lock_dir/ingestion.lock"
if ! flock -w "$ingestion_lock_wait" 8; then
  echo "timed out waiting for the global Oculis ingestion lock" >&2
  exit 75
fi

# Only releases created by the reviewed deploy engine carry exact full-SHA metadata.
target_release=""
shopt -s nullglob
for candidate in "$releases_dir/${target_sha:0:12}-"*; do
  [[ -d "$candidate" && -f "$candidate/.oculis-release" ]] || continue
  [[ ! -L "$candidate/.oculis-release" ]] || continue
  metadata_owner="$(stat -c '%u' "$candidate/.oculis-release")"
  metadata_mode="$(stat -c '%a' "$candidate/.oculis-release")"
  metadata_links="$(stat -c '%h' "$candidate/.oculis-release")"
  [[ "$metadata_owner" == "0" && "$metadata_links" == "1" ]] || continue
  (( (8#$metadata_mode & 022) == 0 )) || continue
  metadata="$(sed -n 's/^GITHUB_SHA=//p' "$candidate/.oculis-release" | head -n 1)"
  [[ "$metadata" == "$target_sha" ]] || continue
  if [[ -z "$target_release" || "$candidate" -nt "$target_release" ]]; then
    target_release="$candidate"
  fi
done
shopt -u nullglob
if [[ -z "$target_release" ]]; then
  echo "no retained release matches requested SHA" >&2
  exit 66
fi

# Load runtime secrets only after the root-owned wrapper selected a retained release.
validate_runtime_env_file "$env_file"
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a
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
  "DATABASE_URL=${DATABASE_URL:-}"
  "OCULIS_DB_APP_NAME=${OCULIS_DB_APP_NAME:-oculis-vps-rollback}"
  "PG_POOL_MAX=${PG_POOL_MAX:-5}"
  "OCULIS_MIN_READY_INITIATIVES=${OCULIS_MIN_READY_INITIATIVES:-}"
)
"${runtime_db_env[@]}" node \
  "$target_release/ops/vps/scripts/check-database-content.mjs" --assert-content

old_release=""
if [[ -L "$current_link" ]]; then
  old_release="$(readlink -f "$current_link")"
fi
target_schema_fingerprint="$(sed -n 's/^SCHEMA_FINGERPRINT=//p' \
  "$target_release/.oculis-release" | head -n 1)"
current_schema_fingerprint=""
if [[ -n "$old_release" && -f "$old_release/.oculis-release" ]]; then
  if [[ -L "$old_release/.oculis-release" || \
    "$(stat -c '%u' "$old_release/.oculis-release")" != "0" || \
    "$(stat -c '%h' "$old_release/.oculis-release")" != "1" ]] || \
    (( (8#$(stat -c '%a' "$old_release/.oculis-release") & 022) != 0 )); then
    echo "active release metadata is unsafe" >&2
    exit 78
  fi
  current_schema_fingerprint="$(sed -n 's/^SCHEMA_FINGERPRINT=//p' \
    "$old_release/.oculis-release" | head -n 1)"
fi
if [[ -z "$target_schema_fingerprint" || -z "$current_schema_fingerprint" || \
  "$target_schema_fingerprint" != "$current_schema_fingerprint" ]]; then
  echo "code-only rollback refused across unknown or different database schemas" >&2
  exit 65
fi
release_env_backup="$(mktemp "${TMPDIR:-/tmp}/oculis-rollback-env.XXXXXXXX")"
cleanup() { rm -f -- "$release_env_backup"; }
trap cleanup EXIT
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
  local temporary_link="$deploy_root/.current.rollback.$$.new"
  ln -s -- "$target" "$temporary_link"
  mv -Tf -- "$temporary_link" "$current_link"
}

restore_old_release() {
  echo "Rollback target failed acceptance; restoring prior release" >&2
  if [[ -n "$old_release" && -d "$old_release" ]]; then
    activate_release "$old_release"
    restore_release_env
    "${systemctl_command[@]}" restart "$service_name" || true
  else
    unlink "$current_link" 2>/dev/null || true
    rm -f -- "$release_env_file"
    "${systemctl_command[@]}" stop "$service_name" || true
  fi
  exit 1
}

activation_started=0
rollback_accepted=0
abort_after_activation() {
  local signal_name="$1"
  echo "Rollback interrupted by $signal_name" >&2
  if (( activation_started == 1 && rollback_accepted == 0 )); then
    restore_old_release
  fi
  exit 1
}
trap 'abort_after_activation HUP' HUP
trap 'abort_after_activation INT' INT
trap 'abort_after_activation TERM' TERM

activation_started=1
activate_release "$target_release"
write_release_env "$target_sha"
if ! "${systemctl_command[@]}" restart "$service_name"; then
  restore_old_release
fi

accepted=0
for _attempt in {1..30}; do
  health_response="$(curl --silent --show-error --fail --max-time 5 \
    http://127.0.0.1:3000/api/health 2>/dev/null)" || health_response=""
  ready_response="$(curl --silent --show-error --fail --max-time 8 \
    http://127.0.0.1:3000/api/ready 2>/dev/null)" || ready_response=""
  if OCULIS_HEALTH_PAYLOAD="$health_response" \
    OCULIS_READY_PAYLOAD="$ready_response" \
    OCULIS_EXPECTED_RELEASE="$target_sha" \
    node --input-type=module -e '
      try {
        const health = JSON.parse(process.env.OCULIS_HEALTH_PAYLOAD || "null");
        const ready = JSON.parse(process.env.OCULIS_READY_PAYLOAD || "null");
        if (
          health?.status !== "ok" || health?.service !== "oculis-web" ||
          health?.release !== process.env.OCULIS_EXPECTED_RELEASE ||
          ready?.status !== "ready" || ready?.service !== "oculis-web" ||
          ready?.database !== "postgresql"
        ) process.exit(1);
      } catch { process.exit(1); }
    '; then
    accepted=1
    break
  fi
  sleep 2
done
if (( accepted == 0 )); then
  restore_old_release
fi

rollback_accepted=1
trap - HUP INT TERM
flock -u 8
printf 'rollback_commit=%s\nrelease=%s\nreplaced=%s\n' \
  "$target_sha" "$target_release" "${old_release:-none}"
