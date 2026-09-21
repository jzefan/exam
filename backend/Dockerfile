## syntax=docker/dockerfile:1.7
ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}
ARG DEBIAN_APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
# Unlike older Playwright archives, recent Chrome for Testing paths are not
# mirrored verbatim by every CDN. This host intentionally receives a URL
# without Playwright's `builds/cft/` prefix.
ARG CHROMIUM_FOR_TESTING_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/chrome-for-testing
ARG TARGETARCH

# Production image for the FastAPI backend.
# Notes:
# - Use uv.lock for reproducible installs.
# - Run migrations separately in scripts/deploy.sh before switching traffic.
# - Secrets come from server-side env files, not from the image.

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    UV_INDEX_URL=${UV_INDEX_URL} \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PATH="/app/.venv/bin:${PATH}"

WORKDIR /app

RUN if [ -n "${DEBIAN_APT_MIRROR}" ]; then \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        sed -i "s|http://deb.debian.org/debian|${DEBIAN_APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
        sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_APT_MIRROR}-security|g" /etc/apt/sources.list.d/debian.sources; \
      elif [ -f /etc/apt/sources.list ]; then \
        sed -i "s|http://deb.debian.org/debian|${DEBIAN_APT_MIRROR}|g" /etc/apt/sources.list; \
        sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_APT_MIRROR}-security|g" /etc/apt/sources.list; \
      fi; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --extra chaoxing

# Install OS libraries via the Playwright CLI, then download the exact Chrome
# for Testing archive ourselves. It avoids Playwright adding `builds/cft/` to
# mirrors that intentionally publish the archive without that prefix.
RUN python -m playwright install-deps chromium \
    && chromium_version="$(python -c 'import json, pathlib; p = pathlib.Path(__import__("playwright").__file__).parent / "driver/package/browsers.json"; print(next(x["browserVersion"] for x in json.loads(p.read_text())["browsers"] if x["name"] == "chromium"))')" \
    && case "${TARGETARCH}" in \
         amd64) platform=linux64; archive=chrome-linux64.zip ;; \
         arm64) platform=linux-arm64; archive=chrome-linux-arm64.zip ;; \
         *) echo "Unsupported Chromium architecture: ${TARGETARCH}" >&2; exit 1 ;; \
       esac \
    && browser_url="${CHROMIUM_FOR_TESTING_DOWNLOAD_HOST}/${chromium_version}/${platform}/${archive}" \
    && fallback_url="https://cdn.playwright.dev/builds/cft/${chromium_version}/${platform}/${archive}" \
    && mkdir -p /opt/chaoxing-chrome \
    && if ! curl --fail --location --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 1800 --output /tmp/chromium.zip "${browser_url}"; then \
         echo "Chromium mirror failed; retrying the official Playwright CDN" >&2; \
         curl --fail --location --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 1800 --output /tmp/chromium.zip "${fallback_url}"; \
       fi \
    && unzip -q /tmp/chromium.zip -d /opt/chaoxing-chrome \
    && test -x "$(find /opt/chaoxing-chrome -type f -path '*/chrome-linux*/chrome' -print -quit)" \
    && printf '%s\n' '#!/bin/sh' 'set -eu' 'exec "$(find /opt/chaoxing-chrome -type f -path "*/chrome-linux*/chrome" -print -quit)" "$@"' > /usr/local/bin/chaoxing-chromium \
    && chmod 0755 /usr/local/bin/chaoxing-chromium \
    && rm -f /tmp/chromium.zip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/chaoxing

COPY src ./src
COPY alembic ./alembic
COPY alembic.ini ./

ENV PYTHONPATH=/app/src

EXPOSE 8000

CMD ["python", "-m", "app.chaoxing.runtime"]
