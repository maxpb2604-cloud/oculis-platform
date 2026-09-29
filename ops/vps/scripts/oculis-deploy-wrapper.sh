#!/usr/bin/env bash
set -euo pipefail

# Stable, root-owned entrypoint for CI and reviewed operator actions. It never
# executes a deploy engine from a mutable application release. The trusted runner
# drops only build commands to a dedicated account that cannot read runtime secrets.
if (( EUID != 0 )); then
  echo "oculis-deploy must be invoked through sudo" >&2
  exit 77
fi

usage() {
  echo "usage:" >&2
  echo "  oculis-deploy FULL_SHA" >&2
  echo "  oculis-deploy bootstrap-empty FULL_SHA" >&2
  echo "  oculis-deploy private FULL_SHA" >&2
  echo "  oculis-deploy rollback FULL_SHA" >&2
  exit 64
}

is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

operation="deploy"
phase="production"
schema_mode="verify"
first_arg="${1:-}"
case "$#:$first_arg" in
  1:*)
    is_sha "$1" || usage
    target_sha="$1"
    ;;
  2:bootstrap-empty)
    is_sha "$2" || usage
    target_sha="$2"
    phase="bootstrap-private"
    schema_mode="bootstrap-empty"
    ;;
  2:private)
    is_sha "$2" || usage
    target_sha="$2"
    phase="bootstrap-private"
    ;;
  2:rollback)
    is_sha "$2" || usage
    target_sha="$2"
    operation="rollback"
    ;;
  *) usage ;;
esac

config_file="/etc/oculis/deploy.env"
if [[ -r "$config_file" ]]; then
  config_owner="$(stat -c '%u' "$config_file")"
  config_mode="$(stat -c '%a' "$config_file")"
  if [[ "$config_owner" != "0" ]] || (( (8#$config_mode & 022) != 0 )); then
    echo "$config_file must be root-owned and not writable by group or other" >&2
    exit 78
  fi
  set -a
  # shellcheck disable=SC1091
  source "$config_file"
  set +a
fi

if [[ "$operation" == "rollback" ]]; then
  runner="/usr/local/libexec/oculis/rollback-release.sh"
else
  runner="/usr/local/libexec/oculis/deploy-release.sh"
fi
if [[ ! -x "$runner" ]]; then
  echo "trusted root-owned Oculis runner is not installed: $runner" >&2
  exit 69
fi
runner_owner="$(stat -c '%u' "$runner")"
runner_mode="$(stat -c '%a' "$runner")"
if [[ "$runner_owner" != "0" ]] || (( (8#$runner_mode & 022) != 0 )); then
  echo "trusted runner must be root-owned and not writable by group or other" >&2
  exit 78
fi

exec /usr/bin/env -i \
  HOME=/root \
  USER=root \
  LOGNAME=root \
  PATH=/usr/local/bin:/usr/bin:/bin \
  OCULIS_REPOSITORY="${OCULIS_REPOSITORY:-https://github.com/maxpb2604-cloud/oculis-platform.git}" \
  OCULIS_DEPLOY_ROOT="${OCULIS_DEPLOY_ROOT:-/opt/oculis}" \
  OCULIS_ENV_FILE="${OCULIS_ENV_FILE:-/etc/oculis/web.env}" \
  OCULIS_BUILD_USER="${OCULIS_BUILD_USER:-oculis-build}" \
  OCULIS_KEEP_RELEASES="${OCULIS_KEEP_RELEASES:-5}" \
  OCULIS_WEB_SERVICE="${OCULIS_WEB_SERVICE:-oculis-web.service}" \
  OCULIS_PUBLIC_PROXY_SERVICE="${OCULIS_PUBLIC_PROXY_SERVICE:-caddy.service}" \
  OCULIS_INGEST_LOCK_WAIT_SECONDS="${OCULIS_INGEST_LOCK_WAIT_SECONDS:-21600}" \
  OCULIS_DEPLOY_PHASE="$phase" \
  OCULIS_SCHEMA_MODE="$schema_mode" \
  OCULIS_DEPLOY_TESTS="${OCULIS_DEPLOY_TESTS:-0}" \
  "$runner" "$target_sha"
