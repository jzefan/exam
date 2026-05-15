ARG NODE_BASE_IMAGE=node:22-alpine
ARG FRONTEND_NGINX_IMAGE=nginx:1.27-alpine
ARG PNPM_REGISTRY=https://registry.npmmirror.com
ARG PNPM_VERSION=10.33.0
FROM ${NODE_BASE_IMAGE} AS build
ARG PNPM_REGISTRY
ARG PNPM_VERSION

# Build the static Vite bundle with pnpm.

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
RUN pnpm config set registry "${PNPM_REGISTRY}"

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM ${FRONTEND_NGINX_IMAGE}

# Serve the built SPA with a tiny internal nginx.
# The outer reverse proxy lives in docker-compose and handles /api routing.

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
