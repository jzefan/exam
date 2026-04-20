#!/usr/bin/env bash
set -euo pipefail

# One-command deployment entrypoint.
# Flow:
# 1. Package the current project locally (excluding sensitive env files and heavy caches)
# 2. Upload the release archive to the server with scp
# 3. Extract to a timestamped release directory
# 4. Build and start the inactive blue/green slot
# 5. Run migrations and health checks
# 6. Switch nginx traffic to the new slot and stop the old slot

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEPLOY_HOST="${DEPLOY_HOST:-146.56.224.80}"
DEPLOY_USER="${DEPLOY_USER:-leishuo}"
DEPLOY_PORT="${DEPLOY_PORT:-3036}"
APP_ROOT="${APP_ROOT:-/home/leishuo/exam-app}"

TIMESTAMP="$(date +"%Y%m%d%H%M%S")"
ARCHIVE_NAME="exam-release-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="${TMPDIR:-/tmp}/${ARCHIVE_NAME}"
REMOTE_ARCHIVE="/tmp/${ARCHIVE_NAME}"

# Prevent macOS tar from writing Apple-specific metadata into the archive.
# This avoids noisy GNU tar warnings on the Linux server during extraction.
export COPYFILE_DISABLE=1

log() {
  printf '\n[%s] %s\n' "$(date +"%H:%M:%S")" "$1"
}

cleanup() {
  rm -f "$ARCHIVE_PATH"
}
trap cleanup EXIT

log "Packaging project for upload"
tar \
  --no-xattrs \
  --exclude-vcs \
  --exclude="./.git" \
  --exclude="./backend/.env" \
  --exclude="./backend/.env.*" \
  --exclude="./frontend/.env" \
  --exclude="./frontend/.env.*" \
  --exclude="./deploy/env/backend.env" \
  --exclude="./deploy/env/database.env" \
  --exclude="./backend/.venv" \
  --exclude="./frontend/node_modules" \
  --exclude="./frontend/dist" \
  --exclude="./backend/__pycache__" \
  --exclude="./backend/.pytest_cache" \
  -czf "$ARCHIVE_PATH" \
  -C "$PROJECT_ROOT" \
  .

log "Uploading archive to ${DEPLOY_USER}@${DEPLOY_HOST}"
scp "$ARCHIVE_PATH" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_ARCHIVE}"

log "Running remote deployment"
ssh "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "APP_ROOT='${APP_ROOT}' DEPLOY_PORT='${DEPLOY_PORT}' REMOTE_ARCHIVE='${REMOTE_ARCHIVE}' bash -s" <<'REMOTE'
set -euo pipefail

APP_ROOT="${APP_ROOT:?missing APP_ROOT}"
DEPLOY_PORT="${DEPLOY_PORT:?missing DEPLOY_PORT}"
REMOTE_ARCHIVE="${REMOTE_ARCHIVE:?missing REMOTE_ARCHIVE}"

RELEASES_DIR="${APP_ROOT}/releases"
SHARED_DIR="${APP_ROOT}/shared"
ENV_DIR="${SHARED_DIR}/env"
NGINX_DIR="${SHARED_DIR}/nginx"
CURRENT_LINK="${APP_ROOT}/current"
DEPLOY_ENV_FILE="${ENV_DIR}/deploy.env"
TIMESTAMP="$(date +"%Y%m%d%H%M%S")"
NEW_RELEASE="${RELEASES_DIR}/${TIMESTAMP}"

log() {
  printf '\n[remote %s] %s\n' "$(date +"%H:%M:%S")" "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

render_nginx_config() {
  local slot="$1"
  sed "s/__SLOT__/${slot}/g" \
    "${CURRENT_LINK}/deploy/nginx/default.conf.template" \
    > "${NGINX_DIR}/default.conf"
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

require_command docker
require_command sed
require_command curl

if [[ -f "${DEPLOY_ENV_FILE}" ]]; then
  # Optional deployment overrides, mainly for registry mirrors and compose project naming.
  set -a
  # shellcheck disable=SC1090
  source "${DEPLOY_ENV_FILE}"
  set +a
fi

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-exam-app}"

mkdir -p "${RELEASES_DIR}" "${ENV_DIR}" "${NGINX_DIR}"
mkdir -p "${NEW_RELEASE}"

log "Extracting release into ${NEW_RELEASE}"
tar -xzf "${REMOTE_ARCHIVE}" -C "${NEW_RELEASE}"
rm -f "${REMOTE_ARCHIVE}"
ln -sfn "${NEW_RELEASE}" "${CURRENT_LINK}"

MISSING_ENV=0
if [[ ! -f "${ENV_DIR}/backend.env" ]]; then
  cp "${CURRENT_LINK}/deploy/env/backend.env.example" "${ENV_DIR}/backend.env"
  echo "Created ${ENV_DIR}/backend.env from example. Fill in real values and re-run deploy." >&2
  MISSING_ENV=1
fi

if [[ ! -f "${ENV_DIR}/database.env" ]]; then
  cp "${CURRENT_LINK}/deploy/env/database.env.example" "${ENV_DIR}/database.env"
  echo "Created ${ENV_DIR}/database.env from example. Fill in real values and re-run deploy." >&2
  MISSING_ENV=1
fi

if [[ ! -f "${DEPLOY_ENV_FILE}" ]]; then
  cp "${CURRENT_LINK}/deploy/env/deploy.env.example" "${DEPLOY_ENV_FILE}"
  echo "Created ${DEPLOY_ENV_FILE} from example. Review image mirror settings if the server cannot access Docker Hub." >&2
fi

if [[ "${MISSING_ENV}" -eq 1 ]]; then
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_DIR}/database.env"
set +a

cd "${CURRENT_LINK}"
export APP_ROOT

ACTIVE_SLOT="$(cat "${NGINX_DIR}/active_slot" 2>/dev/null || true)"
if [[ "${ACTIVE_SLOT}" == "blue" ]]; then
  TARGET_SLOT="green"
else
  TARGET_SLOT="blue"
fi

log "Active slot: ${ACTIVE_SLOT:-none}; target slot: ${TARGET_SLOT}"

log "Starting database"
docker compose up -d db
wait_for_health db 180

log "Building target slot images"
docker compose build "backend_${TARGET_SLOT}" "frontend_${TARGET_SLOT}"

log "Preparing Alembic version table"
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" <<'SQL'
CREATE TABLE IF NOT EXISTS alembic_version (
    version_num VARCHAR(128) NOT NULL
);
ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'alembic_version_pkc'
          AND conrelid = 'alembic_version'::regclass
    ) THEN
        ALTER TABLE alembic_version ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);
    END IF;
END $$;
SQL

log "Running database migrations"
docker compose run --rm --no-deps -T "backend_${TARGET_SLOT}" python -m alembic upgrade head </dev/null

log "Starting target slot containers"
docker compose up -d "backend_${TARGET_SLOT}" "frontend_${TARGET_SLOT}"
wait_for_health "backend_${TARGET_SLOT}" 180
wait_for_health "frontend_${TARGET_SLOT}" 180

log "Switching nginx traffic to ${TARGET_SLOT}"
render_nginx_config "${TARGET_SLOT}"
docker compose up -d nginx
wait_for_health nginx 120
docker compose exec -T nginx nginx -s reload

log "Smoke testing new live traffic"
if ! curl --fail --silent "http://127.0.0.1:${DEPLOY_PORT}/healthz" >/dev/null \
  || ! curl --fail --silent "http://127.0.0.1:${DEPLOY_PORT}/api/health" >/dev/null; then
  echo "Smoke test failed after switching traffic" >&2
  if [[ -n "${ACTIVE_SLOT}" ]]; then
    echo "Rolling back nginx to ${ACTIVE_SLOT}" >&2
    render_nginx_config "${ACTIVE_SLOT}"
    docker compose up -d nginx
    docker compose exec -T nginx nginx -s reload
  fi
  exit 1
fi

echo "${TARGET_SLOT}" > "${NGINX_DIR}/active_slot"

if [[ -n "${ACTIVE_SLOT}" ]]; then
  log "Stopping old slot ${ACTIVE_SLOT}"
  docker compose stop "backend_${ACTIVE_SLOT}" "frontend_${ACTIVE_SLOT}" || true
  docker compose rm -f "backend_${ACTIVE_SLOT}" "frontend_${ACTIVE_SLOT}" || true
fi

log "Cleaning up older releases (keeping latest 5)"
ls -1dt "${RELEASES_DIR}"/* 2>/dev/null | tail -n +6 | xargs -r rm -rf

log "Deployment complete"
echo "Application URL: http://$(hostname -I | awk '{print $1}'):${DEPLOY_PORT}"
REMOTE

log "Deployment finished"
echo "Open http://${DEPLOY_HOST}:${DEPLOY_PORT}"
