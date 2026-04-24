#!/usr/bin/env bash
set -euo pipefail

# Copy the local development PostgreSQL database to the remote Docker deployment.
#
# This is intentionally conservative:
# - It requires --yes before touching the remote database.
# - It backs up the remote database before restore.
# - It stops app containers during restore to avoid concurrent writes.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-146.56.224.80}"
DEPLOY_USER="${DEPLOY_USER:-leishuo}"
DEPLOY_PORT="${DEPLOY_PORT:-3036}"
APP_ROOT="${APP_ROOT:-/home/leishuo/exam-app}"
POSTGRES_CLIENT_IMAGE="${POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"

DEFAULT_LOCAL_DATABASE_URL="postgresql://exam:exam@127.0.0.1:5432/exam"
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-${EXAM_DATABASE_URL:-${DEFAULT_LOCAL_DATABASE_URL}}}"
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL/postgresql+asyncpg:\/\//postgresql:\/\/}"
DOCKER_LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL/@127.0.0.1:/@host.docker.internal:}"
DOCKER_LOCAL_DATABASE_URL="${DOCKER_LOCAL_DATABASE_URL/@localhost:/@host.docker.internal:}"

TIMESTAMP="$(date +"%Y%m%d%H%M%S")"
LOCAL_DUMP="${TMPDIR:-/tmp}/exam-dev-db-${TIMESTAMP}.dump"
REMOTE_DUMP="/tmp/exam-dev-db-${TIMESTAMP}.dump"

CONFIRMED=0
DRY_RUN=0
RESTART_APP=1

usage() {
  cat <<EOF
Usage:
  ./scripts/sync-dev-db-to-server.sh --yes
  ./scripts/sync-dev-db-to-server.sh --dry-run

Options:
  --yes          Really overwrite the remote database.
  --dry-run      Print what would happen without changing anything.
  --no-restart   Restore data but do not restart backend/frontend/nginx.
  -h, --help     Show this help.

Environment variables:
  LOCAL_DATABASE_URL  Local PostgreSQL URL. Default: ${DEFAULT_LOCAL_DATABASE_URL}
  DEPLOY_HOST         Remote host. Default: ${DEPLOY_HOST}
  DEPLOY_USER         Remote SSH user. Default: ${DEPLOY_USER}
  DEPLOY_PORT         Remote app port. Default: ${DEPLOY_PORT}
  APP_ROOT            Remote app root. Default: ${APP_ROOT}
  POSTGRES_CLIENT_IMAGE
                     Docker image used when local pg_dump is missing.
                     Default: ${POSTGRES_CLIENT_IMAGE}

Warning:
  --yes will replace the remote database contents with your local development data.
  The script creates a remote backup first under:
  ${APP_ROOT}/shared/backups/db/
EOF
}

log() {
  printf '\n[%s] %s\n' "$(date +"%H:%M:%S")" "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

dump_local_database() {
  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump --format=custom --no-owner --no-acl --file="${LOCAL_DUMP}" "${LOCAL_DATABASE_URL}"
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    cat >&2 <<EOF
Missing required command: pg_dump

Install PostgreSQL client tools, or install/start Docker so this script can run
pg_dump through ${POSTGRES_CLIENT_IMAGE}.
EOF
    exit 1
  fi

  log "Local pg_dump not found; using Docker image ${POSTGRES_CLIENT_IMAGE}"
  docker run --rm \
    -e PGCONNECT_TIMEOUT=10 \
    -v "$(dirname "${LOCAL_DUMP}"):/dump" \
    "${POSTGRES_CLIENT_IMAGE}" \
    pg_dump --format=custom --no-owner --no-acl --file="/dump/$(basename "${LOCAL_DUMP}")" "${DOCKER_LOCAL_DATABASE_URL}"
}

cleanup() {
  rm -f "${LOCAL_DUMP}"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      CONFIRMED=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --no-restart)
      RESTART_APP=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ "${DRY_RUN}" -eq 1 ]]; then
  cat <<EOF
Dry run only. No database will be changed.

Local database:
  ${LOCAL_DATABASE_URL}

Remote:
  ${DEPLOY_USER}@${DEPLOY_HOST}
  ${APP_ROOT}

Would:
  1. dump local database to ${LOCAL_DUMP}
     - use local pg_dump if available
     - otherwise use Docker image ${POSTGRES_CLIENT_IMAGE}
  2. scp dump to ${REMOTE_DUMP}
  3. backup remote database under ${APP_ROOT}/shared/backups/db/
  4. stop app containers
  5. replace remote public schema from local dump
  6. run alembic upgrade head
  7. restart active app slot and nginx
EOF
  exit 0
fi

if [[ "${CONFIRMED}" -ne 1 ]]; then
  echo "Refusing to overwrite the remote database without --yes." >&2
  echo "Run ./scripts/sync-dev-db-to-server.sh --dry-run to inspect the plan first." >&2
  exit 1
fi

require_command scp
require_command ssh

log "Dumping local development database"
dump_local_database

log "Uploading dump to ${DEPLOY_USER}@${DEPLOY_HOST}"
scp "${LOCAL_DUMP}" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_DUMP}"

log "Restoring dump on remote server"
ssh "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "APP_ROOT='${APP_ROOT}' DEPLOY_PORT='${DEPLOY_PORT}' REMOTE_DUMP='${REMOTE_DUMP}' RESTART_APP='${RESTART_APP}' bash -s" <<'REMOTE'
set -euo pipefail

APP_ROOT="${APP_ROOT:?missing APP_ROOT}"
DEPLOY_PORT="${DEPLOY_PORT:?missing DEPLOY_PORT}"
REMOTE_DUMP="${REMOTE_DUMP:?missing REMOTE_DUMP}"
RESTART_APP="${RESTART_APP:?missing RESTART_APP}"

ENV_DIR="${APP_ROOT}/shared/env"
NGINX_DIR="${APP_ROOT}/shared/nginx"
CURRENT_LINK="${APP_ROOT}/current"
DEPLOY_ENV_FILE="${ENV_DIR}/deploy.env"
DATABASE_ENV_FILE="${ENV_DIR}/database.env"
BACKUP_DIR="${APP_ROOT}/shared/backups/db"
BACKUP_FILE="${BACKUP_DIR}/remote-before-dev-sync-$(date +"%Y%m%d%H%M%S").dump"

log() {
  printf '\n[remote %s] %s\n' "$(date +"%H:%M:%S")" "$1"
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
  sed \
    -e "s/__BACKEND_SLOT__/${slot}/g" \
    -e "s/__FRONTEND_SLOT__/${slot}/g" \
    "${CURRENT_LINK}/deploy/nginx/default.conf.template" \
    > "${NGINX_DIR}/default.conf"
}

if [[ ! -f "${CURRENT_LINK}/docker-compose.yml" ]]; then
  echo "Missing remote deployment at ${CURRENT_LINK}" >&2
  exit 1
fi

if [[ ! -f "${DATABASE_ENV_FILE}" ]]; then
  echo "Missing remote database env file: ${DATABASE_ENV_FILE}" >&2
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

ACTIVE_SLOT="$(cat "${NGINX_DIR}/active_backend_slot" 2>/dev/null || true)"
if [[ -z "${ACTIVE_SLOT}" ]]; then
  ACTIVE_SLOT="$(cat "${NGINX_DIR}/active_slot" 2>/dev/null || true)"
fi
if [[ "${ACTIVE_SLOT}" != "blue" && "${ACTIVE_SLOT}" != "green" ]]; then
  ACTIVE_SLOT="blue"
fi

mkdir -p "${BACKUP_DIR}"

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

docker compose exec -T db pg_restore \
  --exit-on-error \
  --no-owner \
  --role="${POSTGRES_USER}" \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  < "${REMOTE_DUMP}"

log "Verifying restored database"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -c "SELECT count(*) AS public_table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';" \
  -c "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC NULLS LAST, relname LIMIT 12;"

log "Running database migrations after restore"
docker compose run --rm --no-deps -T "backend_${ACTIVE_SLOT}" python -m alembic upgrade head </dev/null

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

log "Cleaning temporary remote dump"
rm -f "${REMOTE_DUMP}"

log "Database sync complete"
REMOTE

log "Done"
echo "Remote app: http://${DEPLOY_HOST}:${DEPLOY_PORT}"
