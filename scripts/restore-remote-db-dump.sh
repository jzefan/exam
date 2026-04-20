#!/usr/bin/env bash
set -euo pipefail

# Restore a PostgreSQL dump that already exists on the remote server into the
# Docker Compose deployment database.
#
# Typical usage on the server:
#   /home/leishuo/exam-app/current/scripts/restore-remote-db-dump.sh --yes /tmp/exam-dev-db.dump
#
# The dump should be a PostgreSQL custom-format dump, for example:
#   pg_dump --format=custom --no-owner --no-acl --file=exam-dev-db.dump "$DATABASE_URL"

APP_ROOT="${APP_ROOT:-/home/leishuo/exam-app}"
DEPLOY_PORT="${DEPLOY_PORT:-3036}"
RESTART_APP=1
RUN_MIGRATIONS=1
CONFIRMED=0
DUMP_FILE=""

usage() {
  cat <<EOF
Usage:
  restore-remote-db-dump.sh --yes /path/to/dump-file.dump

Options:
  --yes             Required. Confirms the remote database may be overwritten.
  --no-restart      Restore data but do not restart backend/frontend/nginx.
  --no-migrations   Restore data but do not run Alembic migrations afterwards.
  -h, --help        Show this help.

Environment variables:
  APP_ROOT          Remote app root. Default: ${APP_ROOT}
  DEPLOY_PORT       Remote app port. Default: ${DEPLOY_PORT}

Warning:
  This script replaces the remote database contents.
  It creates a backup first under:
  ${APP_ROOT}/shared/backups/db/
EOF
}

log() {
  printf '\n[%s] %s\n' "$(date +"%H:%M:%S")" "$1"
}

wait_for_health() {
  local service="$1"
  local timeout="${2:-180}"
  local start_ts
  start_ts="$(date +%s)"

  while true; do
    local container_id
    container_id="$(docker compose -f "${CURRENT_LINK}/docker-compose.yml" ps -q "${service}")"
    if [[ -n "${container_id}" ]]; then
      local health
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
      if [[ "${health}" == "healthy" || "${health}" == "running" ]]; then
        return 0
      fi
    fi

    if (( "$(date +%s)" - start_ts > timeout )); then
      echo "Timed out waiting for ${service} to become healthy" >&2
      docker compose -f "${CURRENT_LINK}/docker-compose.yml" logs "${service}" || true
      return 1
    fi

    sleep 3
  done
}

render_nginx_config() {
  local slot="$1"
  sed "s/__SLOT__/${slot}/g" \
    "${CURRENT_LINK}/deploy/nginx/default.conf.template" \
    > "${NGINX_DIR}/default.conf"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      CONFIRMED=1
      ;;
    --no-restart)
      RESTART_APP=0
      ;;
    --no-migrations)
      RUN_MIGRATIONS=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -n "${DUMP_FILE}" ]]; then
        echo "Only one dump file can be provided." >&2
        usage
        exit 1
      fi
      DUMP_FILE="$1"
      ;;
  esac
  shift
done

if [[ "${CONFIRMED}" -ne 1 ]]; then
  echo "Refusing to overwrite the remote database without --yes." >&2
  usage
  exit 1
fi

if [[ -z "${DUMP_FILE}" ]]; then
  echo "Missing dump file path." >&2
  usage
  exit 1
fi

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "Dump file does not exist: ${DUMP_FILE}" >&2
  exit 1
fi

DUMP_DIR="$(cd "$(dirname "${DUMP_FILE}")" && pwd)"
DUMP_FILE="${DUMP_DIR}/$(basename "${DUMP_FILE}")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Missing required command: docker" >&2
  exit 1
fi

ENV_DIR="${APP_ROOT}/shared/env"
NGINX_DIR="${APP_ROOT}/shared/nginx"
CURRENT_LINK="${APP_ROOT}/current"
DEPLOY_ENV_FILE="${ENV_DIR}/deploy.env"
DATABASE_ENV_FILE="${ENV_DIR}/database.env"
BACKUP_DIR="${APP_ROOT}/shared/backups/db"
BACKUP_FILE="${BACKUP_DIR}/before-manual-restore-$(date +"%Y%m%d%H%M%S").dump"

if [[ ! -f "${CURRENT_LINK}/docker-compose.yml" ]]; then
  echo "Missing remote deployment at ${CURRENT_LINK}" >&2
  exit 1
fi

if [[ ! -f "${DATABASE_ENV_FILE}" ]]; then
  echo "Missing database env file: ${DATABASE_ENV_FILE}" >&2
  exit 1
fi

if [[ -f "${DEPLOY_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${DEPLOY_ENV_FILE}"
  set +a
fi

set -a
# shellcheck disable=SC1090
source "${DATABASE_ENV_FILE}"
set +a

export APP_ROOT
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-exam-app}"

cd "${CURRENT_LINK}"

ACTIVE_SLOT="$(cat "${NGINX_DIR}/active_slot" 2>/dev/null || true)"
if [[ "${ACTIVE_SLOT}" != "blue" && "${ACTIVE_SLOT}" != "green" ]]; then
  ACTIVE_SLOT="blue"
fi

mkdir -p "${BACKUP_DIR}"

log "Using dump file: ${DUMP_FILE}"
log "Active slot: ${ACTIVE_SLOT}"

log "Ensuring database is running"
docker compose up -d db
wait_for_health db 180

log "Backing up current remote database"
docker compose exec -T db pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  > "${BACKUP_FILE}"
echo "Remote backup: ${BACKUP_FILE}"

log "Stopping app containers to avoid writes during restore"
docker compose stop nginx backend_blue frontend_blue backend_green frontend_green || true

log "Replacing remote database contents"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c 'DROP SCHEMA IF EXISTS public CASCADE;' \
  -c 'CREATE SCHEMA public;' \
  -c "ALTER SCHEMA public OWNER TO \"${POSTGRES_USER}\";" \
  -c 'GRANT ALL ON SCHEMA public TO public;'

log "Restoring dump into remote database"
docker compose exec -T db pg_restore \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --role="${POSTGRES_USER}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  < "${DUMP_FILE}"

log "Verifying restored database"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c "SELECT count(*) AS public_table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" \
  -c "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC NULLS LAST, relname LIMIT 20;"

if [[ "${RUN_MIGRATIONS}" -eq 1 ]]; then
  log "Running database migrations after restore"
  docker compose run --rm --no-deps -T "backend_${ACTIVE_SLOT}" python -m alembic upgrade head </dev/null
else
  log "Skipping migrations because --no-migrations was provided"
fi

if [[ "${RESTART_APP}" -eq 1 ]]; then
  log "Restarting active slot ${ACTIVE_SLOT}"
  render_nginx_config "${ACTIVE_SLOT}"
  docker compose up -d "backend_${ACTIVE_SLOT}" "frontend_${ACTIVE_SLOT}" nginx
  wait_for_health "backend_${ACTIVE_SLOT}" 180
  wait_for_health "frontend_${ACTIVE_SLOT}" 180
  wait_for_health nginx 120

  log "Smoke testing live traffic"
  curl --fail --silent "http://127.0.0.1:${DEPLOY_PORT}/healthz" >/dev/null
  curl --fail --silent "http://127.0.0.1:${DEPLOY_PORT}/api/health" >/dev/null
else
  log "Skipping app restart because --no-restart was provided"
fi

log "Restore complete"
echo "Remote app: http://127.0.0.1:${DEPLOY_PORT}"
