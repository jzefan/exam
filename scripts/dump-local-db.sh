#!/usr/bin/env bash
set -euo pipefail

# Dump the local development PostgreSQL database into a custom-format dump file.
# This dump can be uploaded to the server and restored with:
#   scripts/restore-remote-db-dump.sh --yes /path/to/dump-file.dump

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DEFAULT_LOCAL_DATABASE_URL="postgresql://exam:exam@127.0.0.1:5432/exam"
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-${EXAM_DATABASE_URL:-${DEFAULT_LOCAL_DATABASE_URL}}}"
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL/postgresql+asyncpg:\/\//postgresql:\/\/}"
DOCKER_LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL/@127.0.0.1:/@host.docker.internal:}"
DOCKER_LOCAL_DATABASE_URL="${DOCKER_LOCAL_DATABASE_URL/@localhost:/@host.docker.internal:}"

POSTGRES_CLIENT_IMAGE="${POSTGRES_CLIENT_IMAGE:-postgres:17-alpine}"
OUTPUT_DIR="${OUTPUT_DIR:-${PROJECT_ROOT}/tmp/db-dumps}"
TIMESTAMP="$(date +"%Y%m%d%H%M%S")"
OUTPUT_FILE=""

usage() {
  cat <<EOF
Usage:
  ./scripts/dump-local-db.sh
  ./scripts/dump-local-db.sh --output /path/to/exam-dev-db.dump

Options:
  --output FILE   Output dump file path.
  -h, --help      Show this help.

Environment variables:
  LOCAL_DATABASE_URL      Local PostgreSQL URL.
                          Default: ${DEFAULT_LOCAL_DATABASE_URL}
  OUTPUT_DIR              Default output directory.
                          Default: ${OUTPUT_DIR}
  POSTGRES_CLIENT_IMAGE   Docker image used when local pg_dump is missing.
                          Default: ${POSTGRES_CLIENT_IMAGE}
EOF
}

log() {
  printf '\n[%s] %s\n' "$(date +"%H:%M:%S")" "$1"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      if [[ $# -lt 2 ]]; then
        echo "--output requires a file path." >&2
        exit 1
      fi
      OUTPUT_FILE="$2"
      shift
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

if [[ -z "${OUTPUT_FILE}" ]]; then
  OUTPUT_FILE="${OUTPUT_DIR}/exam-dev-db-${TIMESTAMP}.dump"
fi

mkdir -p "$(dirname "${OUTPUT_FILE}")"

dump_with_local_pg_dump() {
  pg_dump --format=custom --no-owner --no-acl --file="${OUTPUT_FILE}" "${LOCAL_DATABASE_URL}"
}

dump_with_docker_pg_dump() {
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
    -v "$(cd "$(dirname "${OUTPUT_FILE}")" && pwd):/dump" \
    "${POSTGRES_CLIENT_IMAGE}" \
    pg_dump --format=custom --no-owner --no-acl --file="/dump/$(basename "${OUTPUT_FILE}")" "${DOCKER_LOCAL_DATABASE_URL}"
}

log "Dumping local database"
echo "Database: ${LOCAL_DATABASE_URL}"
echo "Output:   ${OUTPUT_FILE}"

if command -v pg_dump >/dev/null 2>&1; then
  dump_with_local_pg_dump
else
  dump_with_docker_pg_dump
fi

log "Dump complete"
ls -lh "${OUTPUT_FILE}"
