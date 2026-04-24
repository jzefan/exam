## syntax=docker/dockerfile:1.7
ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}
ARG DEBIAN_APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn
ARG INSTALL_JDTLS=1
ARG JDTLS_BASE_URL=https://download.eclipse.org/jdtls/milestones
ARG JDTLS_CONNECT_TIMEOUT=30
ARG JDTLS_MAX_TIME=1800

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    UV_INDEX_URL=${UV_INDEX_URL} \
    NPM_CONFIG_REGISTRY=${NPM_REGISTRY} \
    GOPROXY=${GOPROXY} \
    GOSUMDB=${GOSUMDB} \
    GOPATH=/root/go \
    PATH="/app/.venv/bin:/root/go/bin:${PATH}"

ARG JDTLS_VERSION=1.58.0

WORKDIR /app

RUN set -eux; \
    restore_default_sources() { \
      if [ -f /tmp/debian.sources.bak ]; then \
        mv /tmp/debian.sources.bak /etc/apt/sources.list.d/debian.sources; \
      fi; \
      if [ -f /tmp/sources.list.bak ]; then \
        mv /tmp/sources.list.bak /etc/apt/sources.list; \
      fi; \
    }; \
    if [ -n "${DEBIAN_APT_MIRROR}" ]; then \
      if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
        cp /etc/apt/sources.list.d/debian.sources /tmp/debian.sources.bak; \
        sed -i "s|http://deb.debian.org/debian|${DEBIAN_APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; \
        sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_APT_MIRROR}-security|g" /etc/apt/sources.list.d/debian.sources; \
      elif [ -f /etc/apt/sources.list ]; then \
        cp /etc/apt/sources.list /tmp/sources.list.bak; \
        sed -i "s|http://deb.debian.org/debian|${DEBIAN_APT_MIRROR}|g" /etc/apt/sources.list; \
        sed -i "s|http://deb.debian.org/debian-security|${DEBIAN_APT_MIRROR}-security|g" /etc/apt/sources.list; \
      fi; \
    fi; \
    if ! apt-get update; then \
      restore_default_sources; \
      apt-get update; \
    fi; \
    if ! apt-cache show curl >/dev/null 2>&1; then \
      restore_default_sources; \
      apt-get update; \
    fi; \
    apt-get install -y --no-install-recommends build-essential curl clangd golang-go nodejs npm openjdk-21-jdk-headless tar \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

COPY lsp-runner-requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv venv .venv \
    && uv pip install --python .venv/bin/python -r lsp-runner-requirements.txt

RUN --mount=type=cache,target=/var/cache/jdtls \
    npm install -g pyright typescript typescript-language-server \
    && GOBIN=/usr/local/bin go install golang.org/x/tools/gopls@latest \
    && if [ "${INSTALL_JDTLS}" = "1" ]; then \
      mkdir -p /opt/jdtls /var/cache/jdtls \
      && curl --retry 8 --retry-all-errors --retry-delay 3 --connect-timeout "${JDTLS_CONNECT_TIMEOUT}" --max-time 300 -fsSL "${JDTLS_BASE_URL}/${JDTLS_VERSION}/latest.txt" -o /var/cache/jdtls/latest.txt \
      && JDTLS_ARCHIVE="$(cat /var/cache/jdtls/latest.txt)" \
      && JDTLS_ARCHIVE_PATH="/var/cache/jdtls/${JDTLS_ARCHIVE}" \
      && curl --continue-at - --retry 8 --retry-all-errors --retry-delay 3 --connect-timeout "${JDTLS_CONNECT_TIMEOUT}" --max-time "${JDTLS_MAX_TIME}" -fsSL "${JDTLS_BASE_URL}/${JDTLS_VERSION}/${JDTLS_ARCHIVE}" -o "${JDTLS_ARCHIVE_PATH}" \
      && rm -rf /opt/jdtls/* \
      && tar -xzf "${JDTLS_ARCHIVE_PATH}" -C /opt/jdtls \
      && printf '%s\n' \
        '#!/bin/sh' \
        'set -eu' \
        'WORKSPACE_DIR="${1:-/tmp/jdtls-workspace}"' \
        'LAUNCHER_JAR="$(find /opt/jdtls/plugins -name '\''org.eclipse.equinox.launcher_*.jar'\'' | head -n 1)"' \
        'exec java -Declipse.application=org.eclipse.jdt.ls.core.id1 -Dosgi.bundles.defaultStartLevel=4 -Declipse.product=org.eclipse.jdt.ls.core.product -Dlog.protocol=true -Dlog.level=ERROR -Xms256m -Xmx768m --add-modules=ALL-SYSTEM --add-opens java.base/java.util=ALL-UNNAMED --add-opens java.base/java.lang=ALL-UNNAMED -jar "$LAUNCHER_JAR" -configuration /opt/jdtls/config_linux -data "$WORKSPACE_DIR"' \
        > /usr/local/bin/jdtls-wrapper \
      && chmod +x /usr/local/bin/jdtls-wrapper; \
    fi

COPY src ./src

ENV PYTHONPATH=/app/src

EXPOSE 8020

CMD ["uvicorn", "app.lsp_runner.main:app", "--host", "0.0.0.0", "--port", "8020"]
