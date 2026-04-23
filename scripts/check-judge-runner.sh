#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

APP_ROOT="${APP_ROOT:-}"
if [[ -z "${APP_ROOT}" ]]; then
  if [[ -d "${PROJECT_ROOT}/shared/nginx" ]]; then
    APP_ROOT="${PROJECT_ROOT}"
  elif [[ -d "${PROJECT_ROOT}/../shared/nginx" ]]; then
    APP_ROOT="$(cd "${PROJECT_ROOT}/.." && pwd)"
  elif [[ -d "${PROJECT_ROOT}/../../shared/nginx" ]]; then
    APP_ROOT="$(cd "${PROJECT_ROOT}/../.." && pwd)"
  fi
fi

ACTIVE_SLOT_FILE=""
if [[ -n "${APP_ROOT}" && -f "${APP_ROOT}/shared/nginx/active_slot" ]]; then
  ACTIVE_SLOT_FILE="${APP_ROOT}/shared/nginx/active_slot"
fi

CURRENT_SLOT=""
if [[ -n "${ACTIVE_SLOT_FILE}" ]]; then
  CURRENT_SLOT="$(tr -d '[:space:]' < "${ACTIVE_SLOT_FILE}")"
fi

log() {
  printf '\n[%s] %s\n' "$(date +"%H:%M:%S")" "$1"
}

pass() {
  printf '  [PASS] %s\n' "$1"
}

fail() {
  printf '  [FAIL] %s\n' "$1" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

compose_ps_id() {
  docker compose ps -q "$1" 2>/dev/null || true
}

container_health() {
  local container_id="$1"
  docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}"
}

detect_backend_service() {
  if [[ "${CURRENT_SLOT}" == "blue" || "${CURRENT_SLOT}" == "green" ]]; then
    echo "backend_${CURRENT_SLOT}"
    return 0
  fi

  local blue_id green_id
  blue_id="$(compose_ps_id backend_blue)"
  green_id="$(compose_ps_id backend_green)"

  if [[ -n "${blue_id}" && -n "${green_id}" ]]; then
    local blue_started green_started
    blue_started="$(docker inspect --format '{{.State.StartedAt}}' "${blue_id}")"
    green_started="$(docker inspect --format '{{.State.StartedAt}}' "${green_id}")"
    if [[ "${blue_started}" > "${green_started}" ]]; then
      echo "backend_blue"
    else
      echo "backend_green"
    fi
    return 0
  fi

  if [[ -n "${blue_id}" ]]; then
    echo "backend_blue"
    return 0
  fi

  if [[ -n "${green_id}" ]]; then
    echo "backend_green"
    return 0
  fi

  return 1
}

check_service_running() {
  local service="$1"
  local container_id
  container_id="$(compose_ps_id "${service}")"
  if [[ -z "${container_id}" ]]; then
    fail "${service} is not running"
    return 1
  fi

  local health
  health="$(container_health "${container_id}")"
  if [[ "${health}" == "healthy" || "${health}" == "running" ]]; then
    pass "${service} is ${health}"
    return 0
  fi

  fail "${service} is ${health}"
  return 1
}

check_backend_env() {
  local service="$1"
  local value
  value="$(docker compose exec -T "${service}" python - <<'PY'
import os
print(os.getenv("EXAM_JUDGE_RUNNER_URL", ""))
PY
)"

  if [[ "${value}" == "http://judge_runner:8010" ]]; then
    pass "${service} has EXAM_JUDGE_RUNNER_URL=http://judge_runner:8010"
    return 0
  fi

  fail "${service} EXAM_JUDGE_RUNNER_URL is '${value}'"
  return 1
}

check_backend_to_judge_runner() {
  local service="$1"
  local output
  if ! output="$(docker compose exec -T "${service}" python - <<'PY'
import urllib.request
print(urllib.request.urlopen("http://judge_runner:8010/health", timeout=5).read().decode())
PY
)"; then
    fail "${service} cannot reach judge_runner health endpoint"
    return 1
  fi

  if [[ "${output}" == *'"status":"ok"'* || "${output}" == *'"status": "ok"'* ]]; then
    pass "${service} can reach judge_runner health endpoint"
    return 0
  fi

  fail "${service} received unexpected judge_runner health response: ${output}"
  return 1
}

main() {
  require_command docker

  cd "${PROJECT_ROOT}"

  log "Checking judge-runner deployment in ${PROJECT_ROOT}"

  local backend_service
  if ! backend_service="$(detect_backend_service)"; then
    fail "Could not determine active backend slot"
    echo "Hint: ensure backend_blue or backend_green is running, or set APP_ROOT so active_slot can be read." >&2
    exit 1
  fi

  printf '  Active backend service: %s\n' "${backend_service}"

  local failures=0

  check_service_running db || failures=$((failures + 1))
  check_service_running judge_runner || failures=$((failures + 1))
  check_service_running "${backend_service}" || failures=$((failures + 1))

  check_backend_env "${backend_service}" || failures=$((failures + 1))
  check_backend_to_judge_runner "${backend_service}" || failures=$((failures + 1))

  if (( failures > 0 )); then
    log "Judge-runner verification failed with ${failures} issue(s)"
    echo "Next steps:"
    echo "  1. Run: docker compose ps"
    echo "  2. Run: docker compose logs judge_runner"
    echo "  3. Run: docker compose logs ${backend_service}"
    exit 1
  fi

  log "Judge-runner verification passed"
}

main "$@"
