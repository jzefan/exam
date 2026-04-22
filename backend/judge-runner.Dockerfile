ARG PYTHON_BASE_IMAGE=python:3.12-slim
FROM ${PYTHON_BASE_IMAGE}
ARG DEBIAN_APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    UV_INDEX_URL=${UV_INDEX_URL} \
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
    && apt-get install -y --no-install-recommends build-essential nodejs default-jdk-headless golang-go \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY src ./src

ENV PYTHONPATH=/app/src

EXPOSE 8010

CMD ["uvicorn", "app.judge_runner.main:app", "--host", "0.0.0.0", "--port", "8010"]
