#!/usr/bin/env bash
# Remote half of scripts/deploy.sh.
#
# deploy.sh uploads this file with scp and runs it as
#   ssh host "APP_ROOT=... bash /tmp/exam-deploy-remote.sh"
# so the script is never fed through ssh stdin.
#
# DO NOT go back to `ssh host "bash -s" <<'REMOTE'`: any command that reads
# stdin (`docker compose exec -T ...`, `docker exec -i ...`) then swallows the
# rest of the script, bash exits 0 at EOF, and the deployment is silently
# truncated after the containers were already started.
#
# The last line prints DEPLOY_OK; the local half greps for it and fails the
# run when it is missing.

set -euo pipefail

APP_ROOT="${APP_ROOT:?missing APP_ROOT}"
DEPLOY_PORT="${DEPLOY_PORT:?missing DEPLOY_PORT}"
DEPLOY_TARGET="${DEPLOY_TARGET:?missing DEPLOY_TARGET}"
REMOTE_ARCHIVE="${REMOTE_ARCHIVE:?missing REMOTE_ARCHIVE}"
DEPLOY_SOURCE_SHA256="${DEPLOY_SOURCE_SHA256:?missing DEPLOY_SOURCE_SHA256}"
if [[ ! "${DEPLOY_SOURCE_SHA256}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "Invalid deployment source SHA-256" >&2
  exit 1
fi
RELEASE_ID="${DEPLOY_SOURCE_SHA256}"

RELEASES_DIR="${APP_ROOT}/releases"
SHARED_DIR="${APP_ROOT}/shared"
ENV_DIR="${SHARED_DIR}/env"
NGINX_DIR="${SHARED_DIR}/nginx"
UPLOADS_DIR="${SHARED_DIR}/uploads"
CURRENT_LINK="${APP_ROOT}/current"
PREVIOUS_RELEASE="$(readlink "${CURRENT_LINK}" 2>/dev/null || true)"
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
  local output_file="${3:-${NGINX_DIR}/default.conf}"
  sed \
    -e "s/__BACKEND_SLOT__/${backend_slot}/g" \
    -e "s/__FRONTEND_SLOT__/${frontend_slot}/g" \
    "${CURRENT_LINK}/deploy/nginx/default.conf.template" \
    > "${output_file}"
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

service_is_healthy() {
  local service="$1"
  local container_id health

  container_id="$(docker compose -f "${CURRENT_LINK}/docker-compose.yml" ps -q "${service}" | head -n 1)"
  [[ -n "${container_id}" ]] || return 1

  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
  [[ "${health}" == "healthy" || "${health}" == "running" ]]
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

if target_includes_frontend; then
  FRONTEND_PUBLIC_DIR="${NEW_RELEASE}/frontend/public"
  if [[ ! -d "${FRONTEND_PUBLIC_DIR}" ]]; then
    echo "Frontend public directory is missing from the release archive" >&2
    exit 1
  fi
  printf '{"release_id":"%s","source_sha256":"%s"}\n' \
    "${RELEASE_ID}" "${DEPLOY_SOURCE_SHA256}" > "${FRONTEND_PUBLIC_DIR}/__release.json"
  log "Frontend release marker: ${RELEASE_ID}"
fi

# Existing server env files are deliberately not replaced by example files.
# Add the new default only when absent; preserve an administrator's explicit false.
if target_includes_backend && ! grep -Eq '^[[:space:]]*(export[[:space:]]+)?EXAM_CHAOXING_ENABLED[[:space:]]*=' "${ENV_DIR}/backend.env"; then
  printf '\n# Enable the bundled teacher connector (one API worker).\nEXAM_CHAOXING_ENABLED=true\n' >> "${ENV_DIR}/backend.env"
  log "Enabled Chaoxing in the existing server backend.env"
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

# Slot files are the intended source of truth, but a failed or interrupted
# release can leave one pointing at a stopped container. Reconcile against
# running healthy containers before choosing the next inactive slot.
if target_includes_backend || target_includes_frontend; then
  if [[ -n "${ACTIVE_BACKEND_SLOT}" ]] && ! service_is_healthy "backend_${ACTIVE_BACKEND_SLOT}"; then
    FALLBACK_BACKEND_SLOT="$(opposite_slot "${ACTIVE_BACKEND_SLOT}")"
    if service_is_healthy "backend_${FALLBACK_BACKEND_SLOT}"; then
      log "Recorded active backend ${ACTIVE_BACKEND_SLOT} is not healthy; reconciling to ${FALLBACK_BACKEND_SLOT}"
      ACTIVE_BACKEND_SLOT="${FALLBACK_BACKEND_SLOT}"
    fi
  fi

  if [[ -n "${ACTIVE_FRONTEND_SLOT}" ]] && ! service_is_healthy "frontend_${ACTIVE_FRONTEND_SLOT}"; then
    FALLBACK_FRONTEND_SLOT="$(opposite_slot "${ACTIVE_FRONTEND_SLOT}")"
    if service_is_healthy "frontend_${FALLBACK_FRONTEND_SLOT}"; then
      log "Recorded active frontend ${ACTIVE_FRONTEND_SLOT} is not healthy; reconciling to ${FALLBACK_FRONTEND_SLOT}"
      ACTIVE_FRONTEND_SLOT="${FALLBACK_FRONTEND_SLOT}"
    fi
  fi
fi

case "${DEPLOY_TARGET}" in
  all|app)
    TARGET_BACKEND_SLOT="$(opposite_slot "${ACTIVE_BACKEND_SLOT:-green}")"
    TARGET_FRONTEND_SLOT="$(opposite_slot "${ACTIVE_FRONTEND_SLOT:-green}")"
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

# A frontend-only deployment cannot recover by building a backend, so fail
# before doing work if neither backend slot is healthy.
if [[ "${DEPLOY_TARGET}" == "frontend" ]] && ! service_is_healthy "backend_${TARGET_BACKEND_SLOT}"; then
  FALLBACK_BACKEND_SLOT="$(opposite_slot "${TARGET_BACKEND_SLOT}")"
  if service_is_healthy "backend_${FALLBACK_BACKEND_SLOT}"; then
    log "Recorded active backend ${TARGET_BACKEND_SLOT} is not healthy; using healthy backend ${FALLBACK_BACKEND_SLOT}"
    ACTIVE_BACKEND_SLOT="${FALLBACK_BACKEND_SLOT}"
    TARGET_BACKEND_SLOT="${FALLBACK_BACKEND_SLOT}"
  else
    echo "Cannot deploy frontend: neither backend_${TARGET_BACKEND_SLOT} nor backend_${FALLBACK_BACKEND_SLOT} is healthy." >&2
    exit 1
  fi
fi

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

# Keep the previous containers intact until the new traffic passes smoke tests.
# This trap also handles pre-switch health failures after a singleton handoff.
SWITCH_STARTED=0
BACKEND_HANDOFF=0
NGINX_BACKUP="${NEW_RELEASE}/previous-nginx.conf"
if [[ -f "${NGINX_DIR}/default.conf" ]]; then
  # Preserve the config Nginx is actually using, including any recovery edits.
  cp "${NGINX_DIR}/default.conf" "${NGINX_BACKUP}"
elif [[ -n "${ACTIVE_BACKEND_SLOT}" && -n "${ACTIVE_FRONTEND_SLOT}" ]]; then
  render_nginx_config "${ACTIVE_BACKEND_SLOT}" "${ACTIVE_FRONTEND_SLOT}" "${NGINX_BACKUP}"
fi
rollback_failed_switch() {
  local status=$?
  if [[ "${status}" -eq 0 || "${SWITCH_STARTED}" -ne 1 ]]; then
    return
  fi
  trap - EXIT
  set +e
  log "Deployment failed; restoring previous traffic"
  if target_includes_backend; then
    docker compose stop "backend_${TARGET_BACKEND_SLOT}"
    if [[ "${BACKEND_HANDOFF}" -eq 1 && -n "${ACTIVE_BACKEND_SLOT}" ]]; then
      # start keeps the old image, environment, and container. Do not use up here.
      docker compose start "backend_${ACTIVE_BACKEND_SLOT}"
      wait_for_health "backend_${ACTIVE_BACKEND_SLOT}" 180
    fi
  fi
  if [[ -f "${NGINX_BACKUP}" ]]; then
    cat "${NGINX_BACKUP}" > "${NGINX_DIR}/default.conf"
    docker compose up -d --no-deps nginx
    docker compose exec -T nginx nginx -s reload </dev/null
  fi
  if [[ -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
    ln -sfn "${PREVIOUS_RELEASE}" "${CURRENT_LINK}"
  fi
  exit "${status}"
}
trap rollback_failed_switch EXIT

# A disconnected SSH session or Ctrl-C must take the same rollback path as a
# failed command. Without these handlers a singleton handoff can leave Nginx
# pointing at the backend that was intentionally stopped moments earlier.
interrupted_deploy() {
  local signal_name="$1"
  local exit_status="$2"
  trap - HUP INT TERM
  log "Deployment interrupted by ${signal_name}; restoring previous traffic"
  exit "${exit_status}"
}
trap 'interrupted_deploy HUP 129' HUP
trap 'interrupted_deploy INT 130' INT
trap 'interrupted_deploy TERM 143' TERM

# Finish frontend builds before a connector handoff to minimize API downtime.
if target_includes_frontend; then
  log "Building target frontend image"
  docker compose build "frontend_${TARGET_FRONTEND_SLOT}"
  log "Starting target frontend slot"
  docker compose up -d "frontend_${TARGET_FRONTEND_SLOT}"
  wait_for_health "frontend_${TARGET_FRONTEND_SLOT}" 180
fi

if target_includes_backend; then
  log "Building target backend image"
  docker compose build "backend_${TARGET_BACKEND_SLOT}"

  if [[ -n "${ACTIVE_BACKEND_SLOT}" && "${ACTIVE_BACKEND_SLOT}" != "${TARGET_BACKEND_SLOT}" ]]; then
    log "Ensuring inactive backend slot ${TARGET_BACKEND_SLOT} is stopped before migrations"
    docker compose stop "backend_${TARGET_BACKEND_SLOT}" || true
    docker compose rm -f "backend_${TARGET_BACKEND_SLOT}" || true
  fi

  # The slot file is the source of truth for the live proxy, but a previous
  # interrupted handoff may have left that container stopped. Restore the
  # recorded live backend before querying its configuration or migrating.
  if [[ -n "${ACTIVE_BACKEND_SLOT}" && "${ACTIVE_BACKEND_SLOT}" != "${TARGET_BACKEND_SLOT}" ]]; then
    ACTIVE_BACKEND_SERVICE="backend_${ACTIVE_BACKEND_SLOT}"
    ACTIVE_BACKEND_ID="$(docker compose ps -aq "${ACTIVE_BACKEND_SERVICE}" | head -n 1)"
    ACTIVE_BACKEND_STATE=""
    if [[ -n "${ACTIVE_BACKEND_ID}" ]]; then
      ACTIVE_BACKEND_STATE="$(docker inspect --format '{{.State.Status}}' "${ACTIVE_BACKEND_ID}" 2>/dev/null || true)"
    fi
    if [[ "${ACTIVE_BACKEND_STATE}" != "running" ]]; then
      log "Restoring recorded active backend ${ACTIVE_BACKEND_SERVICE} before deployment"
      if [[ -n "${ACTIVE_BACKEND_ID}" ]]; then
        docker compose start "${ACTIVE_BACKEND_SERVICE}" || docker compose up -d --no-deps "${ACTIVE_BACKEND_SERVICE}"
      else
        docker compose up -d --no-deps "${ACTIVE_BACKEND_SERVICE}"
      fi
    fi
    wait_for_health "${ACTIVE_BACKEND_SERVICE}" 180
  fi

  log "Checking connector dependencies and Chromium in the target image"
  CHAOXING_MODE="$(docker compose run --rm --no-deps -T "backend_${TARGET_BACKEND_SLOT}" python -m app.chaoxing.runtime check </dev/null)"
  case "${CHAOXING_MODE}" in
    enabled|disabled) ;;
    *) echo "Unexpected connector preflight result" >&2; exit 1 ;;
  esac
  OLD_CHAOXING_MODE=disabled
  if [[ -n "${ACTIVE_BACKEND_SLOT}" ]]; then
    OLD_CHAOXING_MODE="$(docker compose exec -T "backend_${ACTIVE_BACKEND_SLOT}" python -c 'from app.config import settings; print("enabled" if getattr(settings, "chaoxing_enabled", False) else "disabled")' </dev/null)"
  fi
  log "Chaoxing target=${CHAOXING_MODE}, previous=${OLD_CHAOXING_MODE}"

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

  SWITCH_STARTED=1
  if [[ "${CHAOXING_MODE}" == "enabled" || "${OLD_CHAOXING_MODE}" == "enabled" ]]; then
    BACKEND_HANDOFF=1
    if [[ -n "${ACTIVE_BACKEND_SLOT}" ]]; then
      log "Stopping old backend before singleton handoff; temporary API downtime and connector logins will reset"
      docker compose stop -t 45 "backend_${ACTIVE_BACKEND_SLOT}"
    fi
  fi

  log "Starting target backend slot"
  docker compose up -d --no-deps "backend_${TARGET_BACKEND_SLOT}"
  wait_for_health "backend_${TARGET_BACKEND_SLOT}" 180
fi

if target_includes_backend || target_includes_frontend; then
  SWITCH_STARTED=1
  log "Switching nginx traffic to backend=${TARGET_BACKEND_SLOT}, frontend=${TARGET_FRONTEND_SLOT}"
  render_nginx_config "${TARGET_BACKEND_SLOT}" "${TARGET_FRONTEND_SLOT}"
  # Nginx only needs the already-running compose network. Starting its
  # dependencies here can pull unrelated images and strand traffic mid-switch.
  docker compose up -d --no-deps nginx
  wait_for_health nginx 120
  docker compose exec -T nginx nginx -s reload </dev/null

  log "Smoke testing new live traffic"
  # nginx -s reload is graceful: the old workers can still answer the first
  # requests from the previous upstream (which the singleton handoff may have
  # stopped moments earlier). Retry before declaring the switch broken.
  SMOKE_OK=0
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl --fail --silent "http://127.0.0.1:${DEPLOY_PORT}/healthz" >/dev/null \
      && curl --fail --silent "http://127.0.0.1:${DEPLOY_PORT}/api/health" >/dev/null; then
      SMOKE_OK=1
      break
    fi
    sleep 2
  done
  if [[ "${SMOKE_OK}" -ne 1 ]]; then
    echo "Smoke test failed after switching traffic" >&2
    exit 1
  fi

  if target_includes_frontend; then
    EXPECTED_RELEASE_MARKER="{\"release_id\":\"${RELEASE_ID}\",\"source_sha256\":\"${DEPLOY_SOURCE_SHA256}\"}"
    LIVE_RELEASE_MARKER=""
    for attempt in 1 2 3 4 5 6 7 8 9 10; do
      LIVE_RELEASE_MARKER="$(curl --fail --silent "http://127.0.0.1:${DEPLOY_PORT}/__release.json?deploy=${RELEASE_ID}" || true)"
      if [[ "${LIVE_RELEASE_MARKER}" == "${EXPECTED_RELEASE_MARKER}" ]]; then
        break
      fi
      sleep 2
    done
    if [[ "${LIVE_RELEASE_MARKER}" != "${EXPECTED_RELEASE_MARKER}" ]]; then
      echo "Frontend release verification failed: expected ${EXPECTED_RELEASE_MARKER}, got ${LIVE_RELEASE_MARKER:-<empty>}" >&2
      exit 1
    fi
    log "Verified live frontend release ${RELEASE_ID}"
  fi

  CURRENT_BACKEND_SLOT="${TARGET_BACKEND_SLOT}"
  CURRENT_FRONTEND_SLOT="${TARGET_FRONTEND_SLOT}"
  echo "${CURRENT_BACKEND_SLOT}" > "${ACTIVE_BACKEND_SLOT_FILE}"
  echo "${CURRENT_FRONTEND_SLOT}" > "${ACTIVE_FRONTEND_SLOT_FILE}"
  echo "${CURRENT_BACKEND_SLOT}" > "${ACTIVE_SLOT_FILE}"
fi

# The new live traffic is healthy; later cleanup must not roll back this release.
SWITCH_STARTED=0

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

# Cleanup built/packaged Docker images after a successful deployment to reclaim disk space.
# Only runs on the success path (any earlier failure exits the script before reaching here).
if [[ "${DEPLOY_PRUNE_IMAGES:-1}" == "1" ]]; then
  log "Pruning dangling Docker images from the build"
  docker image prune -f || true
fi

if [[ "${DEPLOY_PRUNE_BUILDER:-0}" == "1" ]]; then
  log "Pruning Docker build cache (next build will start from scratch)"
  docker builder prune -f || true
fi


# Completion sentinel consumed by the local half (`grep -q '^DEPLOY_OK '`).
# Absence of this line means the script was truncated; fail loudly on the caller.
printf 'DEPLOY_OK release=%s\n' "${RELEASE_ID}"
