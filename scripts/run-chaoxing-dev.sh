#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT/backend"
export EXAM_CHAOXING_ENABLED=true
# Avoid SQL echoing imported answers and model responses in normal use.
export EXAM_DEBUG="${EXAM_DEBUG:-false}"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/uv-cache}"
export PYTHONPATH=src
# In-memory contexts must stay in one process. No --reload or worker fanout.
exec uv run --extra chaoxing uvicorn app.main:app --host 127.0.0.1 --port "${EXAM_CHAOXING_PORT:-8000}" --workers 1
