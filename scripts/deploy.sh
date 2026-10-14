#!/usr/bin/env bash
set -euo pipefail

# One-command deployment entrypoint.
# Flow:
# 1. Package the current project locally (excluding sensitive env files and heavy caches)
# 2. Upload the release archive and scripts/deploy-remote.sh to the server with scp
# 3. Extract to a timestamped release directory
# 4. Build and validate inactive images (single-instance handoff for Chaoxing)
# 5. Run migrations and health checks
# 6. Switch nginx traffic to the new slot and stop the old slot
# 7. Fail locally unless the remote half printed its DEPLOY_OK sentinel

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
REMOTE_SCRIPT_LOCAL="${SCRIPT_DIR}/deploy-remote.sh"
REMOTE_SCRIPT="/tmp/exam-deploy-remote.sh"
REMOTE_LOG=""

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
  DEPLOY_PRUNE_IMAGES   After a successful deploy, run \`docker image prune -f\` to remove
                        dangling images left by the build. Default: 1 (on).
  DEPLOY_PRUNE_BUILDER  After a successful deploy, run \`docker builder prune -f\` to reclaim
                        build cache (next build starts from scratch). Default: 0 (off).
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
  if [[ -n "${REMOTE_LOG:-}" ]]; then
    rm -f "${REMOTE_LOG}"
  fi
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
  --exclude="./.deploy-check" \
  --exclude="./frontend/.build-check" \
  --exclude="./frontend/test-results" \
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

DEPLOY_SOURCE_SHA256="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
log "Source archive SHA-256: ${DEPLOY_SOURCE_SHA256}"

log "Uploading archive to ${DEPLOY_USER}@${DEPLOY_HOST}"
scp "$ARCHIVE_PATH" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_ARCHIVE}"

log "Uploading remote deployment script"
scp "${REMOTE_SCRIPT_LOCAL}" "${DEPLOY_USER}@${DEPLOY_HOST}:${REMOTE_SCRIPT}"

log "Running remote deployment"
REMOTE_LOG="$(mktemp -t exam-deploy-log)"
# Capture the remote output so a silent truncation (sshd exits 0 at EOF after a
# child stole the script) cannot be mistaken for success.
set +e
ssh "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "APP_ROOT='${APP_ROOT}' DEPLOY_PORT='${DEPLOY_PORT}' DEPLOY_TARGET='${DEPLOY_TARGET}' REMOTE_ARCHIVE='${REMOTE_ARCHIVE}' DEPLOY_SOURCE_SHA256='${DEPLOY_SOURCE_SHA256}' DEPLOY_PRUNE_IMAGES='${DEPLOY_PRUNE_IMAGES:-1}' DEPLOY_PRUNE_BUILDER='${DEPLOY_PRUNE_BUILDER:-0}' bash ${REMOTE_SCRIPT}" 2>&1 | tee "${REMOTE_LOG}"
REMOTE_STATUS="${PIPESTATUS[0]}"
set -e

if [[ "${REMOTE_STATUS}" -ne 0 ]] || ! grep -q '^DEPLOY_OK ' "${REMOTE_LOG}"; then
  echo "Remote deployment did not finish (ssh status=${REMOTE_STATUS}, sentinel missing or partial)" >&2
  echo "--- last 40 lines of the remote output ---" >&2
  tail -n 40 "${REMOTE_LOG}" >&2 || true
  exit 1
fi


log "Deployment finished"
echo "Open http://${DEPLOY_HOST}:${DEPLOY_PORT}"
