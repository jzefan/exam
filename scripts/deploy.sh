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
DEFAULT_DEPLOY_TARGET="all"
DEPLOY_TARGET="${DEPLOY_TARGET:-${DEFAULT_DEPLOY_TARGET}}"

TIMESTAMP="$(date +"%Y%m%d%H%M%S")"
ARCHIVE_NAME="exam-release-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="${TMPDIR:-/tmp}/${ARCHIVE_NAME}"
REMOTE_ARCHIVE="/tmp/${ARCHIVE_NAME}"

# Prevent macOS tar from writing Apple-specific metadata into the archive.
# This avoids noisy GNU tar warnings on the Linux server during extraction.
export COPYFILE_DISABLE=1

usage() {
  cat <<EOF
Usage:
  ./scripts/deploy.sh [--target all|app|frontend|backend|judge-runner|lsp-runner|runners]

Options:
  --target, -t   Deploy target. Default: ${DEFAULT_DEPLOY_TARGET}
                 all          Deploy backend + frontend + runner services
                 app          Deploy backend + frontend, without runner services
                 frontend     Deploy only frontend and nginx traffic switch
                 backend      Deploy backend, migrations, and nginx API switch
                 judge-runner Deploy only judge-runner
                 lsp-runner   Deploy only lsp-runner
                 runners      Deploy judge-runner + lsp-runner
  -h, --help     Show this help.

Environment variables:
  DEPLOY_HOST    Remote host. Default: ${DEPLOY_HOST}
  DEPLOY_USER    Remote SSH user. Default: ${DEPLOY_USER}
  DEPLOY_PORT    Public app port. Default: ${DEPLOY_PORT}
  APP_ROOT       Remote app root. Default: ${APP_ROOT}
  DEPLOY_TARGET  Same as --target. Default all when no argument is provided.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target|-t)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for $1" >&2
        usage
        exit 1
      fi
      DEPLOY_TARGET="$2"
      shift 2
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
done

case "${DEPLOY_TARGET}" in
  all|app|frontend|backend|judge-runner|lsp-runner|runners)
    ;;
  *)
    echo "Invalid deploy target: ${DEPLOY_TARGET}" >&2
    usage
    exit 1
    ;;
esac

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
  --exclude="./.claude" \
  --exclude="./.remember" \
  --exclude="./.pnpm-store" \
  --exclude="./.superpowers" \
  --exclude="./backend/.venv" \
  --exclude="./backend/uploads" \
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
  "APP_ROOT='${APP_ROOT}' DEPLOY_PORT='${DEPLOY_PORT}' DEPLOY_TARGET='${DEPLOY_TARGET}' REMOTE_ARCHIVE='${REMOTE_ARCHIVE}' bash -s" <<'REMOTE'
set -euo pipefail

APP_ROOT="${APP_ROOT:?missing APP_ROOT}"
DEPLOY_PORT="${DEPLOY_PORT:?missing DEPLOY_PORT}"
DEPLOY_TARGET="${DEPLOY_TARGET:?missing DEPLOY_TARGET}"
REMOTE_ARCHIVE="${REMOTE_ARCHIVE:?missing REMOTE_ARCHIVE}"

RELEASES_DIR="${APP_ROOT}/releases"
SHARED_DIR="${APP_ROOT}/shared"
ENV_DIR="${SHARED_DIR}/env"
NGINX_DIR="${SHARED_DIR}/nginx"
UPLOADS_DIR="${SHARED_DIR}/uploads"
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
  local backend_slot="$1"
  local frontend_slot="$2"
  sed \
    -e "s/__BACKEND_SLOT__/${backend_slot}/g" \
    -e "s/__FRONTEND_SLOT__/${frontend_slot}/g" \
    "${CURRENT_LINK}/deploy/nginx/default.conf.template" \
    > "${NGINX_DIR}/default.conf"
}

normalize_slot() {
  local slot="${1:-}"
  if [[ "${slot}" == "blue" || "${slot}" == "green" ]]; then
    printf '%s' "${slot}"
  fi
}

read_slot_file() {
  local primary_file="$1"
  local fallback_file="${2:-}"
  local slot=""

  if [[ -f "${primary_file}" ]]; then
    slot="$(tr -d '[:space:]' < "${primary_file}")"
  fi

  slot="$(normalize_slot "${slot}")"
  if [[ -n "${slot}" ]]; then
    printf '%s' "${slot}"
    return
  fi

  if [[ -n "${fallback_file}" && -f "${fallback_file}" ]]; then
    slot="$(tr -d '[:space:]' < "${fallback_file}")"
    slot="$(normalize_slot "${slot}")"
    printf '%s' "${slot}"
  fi
}

opposite_slot() {
  local slot="$1"
  if [[ "${slot}" == "blue" ]]; then
    printf 'green'
  else
    printf 'blue'
  fi
}

target_includes_backend() {
  [[ "${DEPLOY_TARGET}" == "all" || "${DEPLOY_TARGET}" == "app" || "${DEPLOY_TARGET}" == "backend" ]]
}

target_includes_frontend() {
  [[ "${DEPLOY_TARGET}" == "all" || "${DEPLOY_TARGET}" == "app" || "${DEPLOY_TARGET}" == "frontend" ]]
}

target_includes_judge_runner() {
  [[ "${DEPLOY_TARGET}" == "all" || "${DEPLOY_TARGET}" == "judge-runner" || "${DEPLOY_TARGET}" == "runners" ]]
}

target_includes_lsp_runner() {
  [[ "${DEPLOY_TARGET}" == "all" || "${DEPLOY_TARGET}" == "lsp-runner" || "${DEPLOY_TARGET}" == "runners" ]]
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

mkdir -p "${RELEASES_DIR}" "${ENV_DIR}" "${NGINX_DIR}" "${UPLOADS_DIR}"
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

ACTIVE_SLOT_FILE="${NGINX_DIR}/active_slot"
ACTIVE_BACKEND_SLOT_FILE="${NGINX_DIR}/active_backend_slot"
ACTIVE_FRONTEND_SLOT_FILE="${NGINX_DIR}/active_frontend_slot"

ACTIVE_BACKEND_SLOT="$(read_slot_file "${ACTIVE_BACKEND_SLOT_FILE}" "${ACTIVE_SLOT_FILE}")"
ACTIVE_FRONTEND_SLOT="$(read_slot_file "${ACTIVE_FRONTEND_SLOT_FILE}" "${ACTIVE_SLOT_FILE}")"

case "${DEPLOY_TARGET}" in
  all|app)
    TARGET_SLOT="$(opposite_slot "${ACTIVE_BACKEND_SLOT:-green}")"
    TARGET_BACKEND_SLOT="${TARGET_SLOT}"
    TARGET_FRONTEND_SLOT="${TARGET_SLOT}"
    ;;
  backend)
    if [[ -z "${ACTIVE_FRONTEND_SLOT}" ]]; then
      echo "Cannot do backend-only deploy before a full deploy has established an active frontend slot." >&2
      exit 1
    fi
    TARGET_BACKEND_SLOT="$(opposite_slot "${ACTIVE_BACKEND_SLOT:-green}")"
    TARGET_FRONTEND_SLOT="${ACTIVE_FRONTEND_SLOT}"
    ;;
  frontend)
    if [[ -z "${ACTIVE_BACKEND_SLOT}" ]]; then
      echo "Cannot do frontend-only deploy before a full deploy has established an active backend slot." >&2
      exit 1
    fi
    TARGET_BACKEND_SLOT="${ACTIVE_BACKEND_SLOT}"
    TARGET_FRONTEND_SLOT="$(opposite_slot "${ACTIVE_FRONTEND_SLOT:-green}")"
    ;;
  judge-runner|lsp-runner|runners)
    TARGET_BACKEND_SLOT="${ACTIVE_BACKEND_SLOT:-}"
    TARGET_FRONTEND_SLOT="${ACTIVE_FRONTEND_SLOT:-}"
    ;;
esac

log "Deploy target: ${DEPLOY_TARGET}"
log "Active slots -> backend: ${ACTIVE_BACKEND_SLOT:-none}, frontend: ${ACTIVE_FRONTEND_SLOT:-none}"
if target_includes_backend || target_includes_frontend; then
  log "Target slots -> backend: ${TARGET_BACKEND_SLOT}, frontend: ${TARGET_FRONTEND_SLOT}"
fi

if target_includes_backend || target_includes_judge_runner || target_includes_lsp_runner; then
  log "Starting database"
  docker compose up -d db
  wait_for_health db 180
fi

if target_includes_judge_runner; then
  log "Building judge-runner image"
  docker compose build judge_runner

  log "Starting judge-runner"
  docker compose up -d judge_runner
  wait_for_health judge_runner 180
fi

if target_includes_lsp_runner; then
  log "Building lsp-runner image"
  docker compose build lsp_runner

  log "Starting lsp-runner"
  docker compose up -d lsp_runner
  wait_for_health lsp_runner 180
fi

if target_includes_backend; then
  log "Building target backend image"
  docker compose build "backend_${TARGET_BACKEND_SLOT}"

  if [[ -n "${ACTIVE_BACKEND_SLOT}" && "${ACTIVE_BACKEND_SLOT}" != "${TARGET_BACKEND_SLOT}" ]]; then
    log "Ensuring inactive backend slot ${TARGET_BACKEND_SLOT} is stopped before migrations"
    docker compose stop "backend_${TARGET_BACKEND_SLOT}" || true
    docker compose rm -f "backend_${TARGET_BACKEND_SLOT}" || true
  fi

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
  docker compose run --rm --no-deps -T "backend_${TARGET_BACKEND_SLOT}" python -m alembic upgrade head </dev/null

  log "Starting target backend slot"
  docker compose up -d --no-deps "backend_${TARGET_BACKEND_SLOT}"
  wait_for_health "backend_${TARGET_BACKEND_SLOT}" 180
fi

if target_includes_frontend; then
  log "Building target frontend image"
  docker compose build "frontend_${TARGET_FRONTEND_SLOT}"

  log "Starting target frontend slot"
  docker compose up -d "frontend_${TARGET_FRONTEND_SLOT}"
  wait_for_health "frontend_${TARGET_FRONTEND_SLOT}" 180
fi

if target_includes_backend || target_includes_frontend; then
  log "Switching nginx traffic to backend=${TARGET_BACKEND_SLOT}, frontend=${TARGET_FRONTEND_SLOT}"
  render_nginx_config "${TARGET_BACKEND_SLOT}" "${TARGET_FRONTEND_SLOT}"
  docker compose up -d nginx
  wait_for_health nginx 120
  docker compose exec -T nginx nginx -s reload

  log "Smoke testing new live traffic"
  if ! curl --fail --silent "http://127.0.0.1:${DEPLOY_PORT}/healthz" >/dev/null \
    || ! curl --fail --silent "http://127.0.0.1:${DEPLOY_PORT}/api/health" >/dev/null; then
    echo "Smoke test failed after switching traffic" >&2
    if [[ -n "${ACTIVE_BACKEND_SLOT}" && -n "${ACTIVE_FRONTEND_SLOT}" ]]; then
      echo "Rolling back nginx to backend=${ACTIVE_BACKEND_SLOT}, frontend=${ACTIVE_FRONTEND_SLOT}" >&2
      render_nginx_config "${ACTIVE_BACKEND_SLOT}" "${ACTIVE_FRONTEND_SLOT}"
      docker compose up -d nginx
      docker compose exec -T nginx nginx -s reload
    fi
    exit 1
  fi

  CURRENT_BACKEND_SLOT="${TARGET_BACKEND_SLOT}"
  CURRENT_FRONTEND_SLOT="${TARGET_FRONTEND_SLOT}"
  echo "${CURRENT_BACKEND_SLOT}" > "${ACTIVE_BACKEND_SLOT_FILE}"
  echo "${CURRENT_FRONTEND_SLOT}" > "${ACTIVE_FRONTEND_SLOT_FILE}"
  echo "${CURRENT_BACKEND_SLOT}" > "${ACTIVE_SLOT_FILE}"
fi

if target_includes_backend; then
  if [[ -n "${ACTIVE_BACKEND_SLOT}" && "${ACTIVE_BACKEND_SLOT}" != "${CURRENT_BACKEND_SLOT}" ]]; then
    log "Stopping old backend slot ${ACTIVE_BACKEND_SLOT}"
    docker compose stop "backend_${ACTIVE_BACKEND_SLOT}" || true
    docker compose rm -f "backend_${ACTIVE_BACKEND_SLOT}" || true
  fi
fi

if target_includes_frontend; then
  if [[ -n "${ACTIVE_FRONTEND_SLOT}" && "${ACTIVE_FRONTEND_SLOT}" != "${CURRENT_FRONTEND_SLOT}" ]]; then
    log "Stopping old frontend slot ${ACTIVE_FRONTEND_SLOT}"
    docker compose stop "frontend_${ACTIVE_FRONTEND_SLOT}" || true
    docker compose rm -f "frontend_${ACTIVE_FRONTEND_SLOT}" || true
  fi
fi

log "Cleaning up older releases (keeping latest 5)"
ls -1dt "${RELEASES_DIR}"/* 2>/dev/null | tail -n +6 | xargs -r rm -rf

log "Deployment complete"
echo "Application URL: http://$(hostname -I | awk '{print $1}'):${DEPLOY_PORT}"
REMOTE

log "Deployment finished"
echo "Open http://${DEPLOY_HOST}:${DEPLOY_PORT}"
