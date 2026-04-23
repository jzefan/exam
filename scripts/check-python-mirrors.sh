#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${PACKAGE_NAME:-typing-extensions}"
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-8}"
MAX_TIME="${MAX_TIME:-45}"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: ./scripts/check-python-mirrors.sh

Checks a few common Python package mirrors from the current machine and
recommends the fastest successful option for deploy.env.

Environment variables:
  PACKAGE_NAME       Package used for the test (default: typing-extensions)
  CONNECT_TIMEOUT    curl connect timeout in seconds (default: 8)
  MAX_TIME           curl max time per request in seconds (default: 45)
EOF
  exit 0
fi

log() {
  printf '\n[%s] %s\n' "$(date +"%H:%M:%S")" "$1"
}

candidate_names=(
  "pypi-official"
  "tuna"
  "aliyun"
)

candidate_urls=(
  "https://pypi.org/simple"
  "https://pypi.tuna.tsinghua.edu.cn/simple"
  "https://mirrors.aliyun.com/pypi/simple"
)

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

best_name=""
best_url=""
best_score=""

printf '%-14s %-8s %-14s %-14s %s\n' "mirror" "status" "index_time(s)" "file_time(s)" "url"
printf '%-14s %-8s %-14s %-14s %s\n' "------------" "------" "-------------" "------------" "------------------------------"

for i in "${!candidate_names[@]}"; do
  name="${candidate_names[$i]}"
  base_url="${candidate_urls[$i]%/}"
  index_url="${base_url}/${PACKAGE_NAME}/"
  index_file="${TMP_DIR}/${name}-index.html"
  package_file="${TMP_DIR}/${name}-package.bin"

  status="OK"
  index_time="-"
  file_time="-"

  printf 'checking %-14s %s\n' "${name}" "${base_url}" >&2

  if ! index_time="$(curl -L -sS \
    --connect-timeout "${CONNECT_TIMEOUT}" \
    --max-time "${MAX_TIME}" \
    -o "${index_file}" \
    -w '%{time_total}' \
    "${index_url}" 2>/dev/null)"; then
    status="INDEX_FAIL"
    printf '%-14s %-8s %-14s %-14s %s\n' "${name}" "${status}" "${index_time}" "${file_time}" "${base_url}"
    continue
  fi

  href="$(
    {
      grep -Eo 'href="[^"]+"' "${index_file}" 2>/dev/null | head -n 1 | sed -e 's/^href="//' -e 's/"$//'
    } || true
  )"
  href="${href//&amp;/&}"

  if [[ -z "${href}" ]]; then
    status="PARSE_FAIL"
    printf '%-14s %-8s %-14s %-14s %s\n' "${name}" "${status}" "${index_time}" "${file_time}" "${base_url}"
    continue
  fi

  if [[ "${href}" == http://* || "${href}" == https://* ]]; then
    package_url="${href}"
  elif [[ "${href}" == /* ]]; then
    package_url="${base_url}${href}"
  else
    package_url="${index_url}${href}"
  fi

  if ! file_time="$(curl -L -sS \
    --connect-timeout "${CONNECT_TIMEOUT}" \
    --max-time "${MAX_TIME}" \
    -o "${package_file}" \
    -w '%{time_total}' \
    "${package_url}" 2>/dev/null)"; then
    status="FILE_FAIL"
    printf '%-14s %-8s %-14s %-14s %s\n' "${name}" "${status}" "${index_time}" "${file_time}" "${base_url}"
    continue
  fi

  score="$(awk -v a="${index_time}" -v b="${file_time}" 'BEGIN { printf "%.3f", a + b }')"
  if [[ -z "${best_score}" ]] || awk -v cur="${score}" -v best="${best_score}" 'BEGIN { exit !(cur < best) }'; then
    best_score="${score}"
    best_name="${name}"
    best_url="${base_url}"
  fi

  printf '%-14s %-8s %-14s %-14s %s\n' "${name}" "${status}" "${index_time}" "${file_time}" "${base_url}"
done

if [[ -n "${best_name}" ]]; then
  log "Recommended mirror"
  echo "Mirror: ${best_name}"
  echo "PIP_INDEX_URL=${best_url}"
  echo "UV_INDEX_URL=${best_url}"
  echo
  echo "If this server keeps slowing down during docker build, copy the two lines above into:"
  echo "  shared/env/deploy.env"
  echo
  echo "Then re-run deployment."
else
  log "No mirror check succeeded"
  echo "Try again later or test your server network egress first." >&2
  exit 1
fi
