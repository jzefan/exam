# Docker + Compose 自动化部署

这套部署方案面向服务器 `146.56.224.80`，入口地址为 `http://146.56.224.80:3036`。

## 方案概览

- 容器编排：Docker + docker compose
- 反向代理：Nginx
- 数据库：PostgreSQL
- 代码运行：judge-runner 独立容器
- 发布方式：本地 `scripts/deploy.sh` 打包 -> `scp` 上传 -> 服务器自动构建并切换
- 重启方式：通常蓝绿切换；启用学习通时采用单实例交接，先停旧后端再启新后端，避免两个评分队列同时消费。

## 关键文件

- `/Users/jzefan/work/proj/exam/backend/Dockerfile`
  后端生产镜像，运行 FastAPI。

- `/Users/jzefan/work/proj/exam/frontend/Dockerfile`
  前端生产镜像，多阶段构建后以 Nginx 提供静态资源。

- `/Users/jzefan/work/proj/exam/docker-compose.yml`
  生产编排文件，包含：
  - `db`
  - `judge_runner`
  - `backend_blue` / `backend_green`
  - `frontend_blue` / `frontend_green`
  - `nginx`

- `/Users/jzefan/work/proj/exam/deploy/nginx/default.conf.template`
  外层反向代理模板，部署时替换当前激活槽位。

- `/Users/jzefan/work/proj/exam/deploy/env/backend.env.example`
  后端环境变量示例。

- `/Users/jzefan/work/proj/exam/deploy/env/database.env.example`
  数据库环境变量示例。

- `/Users/jzefan/work/proj/exam/deploy/env/deploy.env.example`
  可选的部署覆盖配置，用于固定 compose 项目名和切换镜像代理。

- `/Users/jzefan/work/proj/exam/scripts/deploy.sh`
  本地一键部署脚本。

## 服务器目录结构

部署后会在服务器上形成如下结构：

```text
/home/leishuo/exam-app
├── current -> releases/<timestamp>
├── releases/
│   ├── 20260419093000/
│   └── ...
└── shared/
    ├── env/
    │   ├── backend.env
    │   └── database.env
    └── nginx/
        ├── active_backend_slot
        ├── active_frontend_slot
        ├── active_slot
        └── default.conf
```

## 首次部署前

先通过一次部署让目录生成，脚本会在服务器缺少 env 文件时自动创建示例文件并停止：

```bash
./scripts/deploy.sh
```

然后到服务器上补齐真实环境变量：

```bash
ssh leishuo@146.56.224.80
vim /home/leishuo/exam-app/shared/env/backend.env
vim /home/leishuo/exam-app/shared/env/database.env
vim /home/leishuo/exam-app/shared/env/deploy.env
```

补完后再次执行：

```bash
./scripts/deploy.sh
```

## 一键部署

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

不带参数时等同于：

```bash
./scripts/deploy.sh --target all
```

也支持按目标部分部署：

```bash
./scripts/deploy.sh --target frontend
./scripts/deploy.sh --target backend
./scripts/deploy.sh --target app
./scripts/deploy.sh --target judge-runner
./scripts/deploy.sh --target lsp-runner
./scripts/deploy.sh --target runners
./scripts/deploy.sh --target all
```

说明：

- `--target frontend`
  只构建和切换前端槽位，后端、数据库、迁移都不动。

- `--target backend`
  只构建和切换后端槽位，并执行迁移；前端、`judge_runner`、`lsp_runner` 保持当前在线版本。

- `--target app`
  同时构建和切换前端、后端，并执行迁移；`judge_runner`、`lsp_runner` 保持当前在线版本。

- `--target judge-runner`
  只构建并重启 `judge_runner`，不切换前后端流量。

- `--target lsp-runner`
  只构建并重启 `lsp_runner`，不切换前后端流量。

- `--target runners`
  同时构建并重启 `judge_runner` 和 `lsp_runner`，不切换前后端流量。

- `--target all`
  完整部署，包含后端、前端、`judge_runner` 和 `lsp_runner`。

注意：

- 首次部署必须使用 `--target all`
- 只有在已经存在在线前后端槽位后，才能安全执行前端单独部署或后端单独部署
- 平时只改业务前后端时，用 `--target app`；只改业务后端时，用 `--target backend`；只有 runner 代码或 runner Dockerfile 改了，才单独执行对应 runner target

脚本自动完成：

1. 打包当前代码
2. `scp` 上传到服务器
3. 解压到新 release 目录
4. 按 target 构建对应服务镜像
5. 如包含后端则运行数据库迁移
6. 启动对应服务或目标蓝绿槽位
7. 健康检查
8. Nginx 切流
9. 下线本次被替换的旧槽位

## 代码运行环境

代码题在线运行不再依赖宿主机是否安装 `go`、`java` 等工具链，而是通过 compose 中的 `judge_runner` 容器统一提供：

- Python
- JavaScript / Node.js
- C
- C++
- Java
- Go

backend 容器通过内部地址 `http://judge_runner:8010` 调用该服务。

`judge_runner` 镜像现在使用独立的最小 Python 依赖清单，不再跟随 backend 安装整套文档解析、数据库和 AI SDK 依赖。这样可以显著减少首轮构建时需要下载的 Python 包数量，尤其适合服务器网络较慢的场景。

部署完成后，可以在服务器的项目目录执行下面的验收脚本，快速确认 backend 已经接上 Docker 判题环境：

```bash
./scripts/check-judge-runner.sh
```

脚本会检查：

- `db`、`judge_runner`、当前活动 backend 容器是否在运行
- `judge_runner` 是否为健康状态
- backend 是否拿到 `EXAM_JUDGE_RUNNER_URL=http://judge_runner:8010`
- backend 容器内是否能访问 `http://judge_runner:8010/health`

## 本地开发调试 judge-runner

如果你本地是“前后端分别启动”，但又想让学生端代码运行支持 Java / Go，可以直接使用仓库里的开发编排：

```bash
docker compose -f docker-compose.dev.yml up -d judge_runner
```

然后用下面的方式启动后端：

```bash
cd backend
EXAM_JUDGE_RUNNER_URL=http://127.0.0.1:8010 uv run uvicorn app.main:app --app-dir src --reload
```

## 构建缓慢排查

如果部署时长时间停留在 Docker 构建阶段的：

```text
RUN uv sync --frozen --no-dev
```

通常不是脚本卡死，而是容器内下载 Python 依赖很慢。当前镜像已经启用了 `uv` 下载缓存；同一台服务器在首次构建完成后，后续重建通常会明显加快。

如果第一次构建就很慢，优先检查 `shared/env/deploy.env` 里的镜像源设置，确认服务器访问下列源是否顺畅：

- `DEBIAN_APT_MIRROR`
- `PIP_INDEX_URL`
- `UV_INDEX_URL`
- `NPM_REGISTRY`
- `GOPROXY`
- `GOSUMDB`
- `JDTLS_BASE_URL`

如果当前默认源在你的服务器网络环境下较慢，可以改成更合适的企业内网源或公共镜像，然后重新执行部署。

如果报错出现在 `lsp_runner` 构建阶段，例如：

```text
go install golang.org/x/tools/gopls@latest ... i/o timeout
```

通常就是 Go 或 Eclipse 下载源太慢。优先在 `/home/leishuo/exam-app/shared/env/deploy.env` 里补这些配置后重试：

```bash
NPM_REGISTRY=https://registry.npmmirror.com
GOPROXY=https://goproxy.cn,direct
GOSUMDB=sum.golang.google.cn
INSTALL_JDTLS=0
JDTLS_BASE_URL=https://download.eclipse.org/jdtls/milestones
JDTLS_CONNECT_TIMEOUT=30
JDTLS_MAX_TIME=1800
```

其中 `INSTALL_JDTLS=0` 表示默认跳过 Java LSP 安装，这样不会因为 `jdtls` 大包下载把整次部署卡死。需要 Java 智能提示时再改成 `1`。`JDTLS_BASE_URL` 默认仍指向官方地址；如果你的服务器访问 Eclipse 官方源很慢，再替换成你能访问的镜像根地址。`JDTLS_MAX_TIME` 是单次大文件下载允许的最长时间，网络特别慢时可以继续调大。

仓库里也提供了一个快速探测脚本，方便你直接在服务器上挑选更快的 Python 源：

```bash
./scripts/check-python-mirrors.sh
```

脚本会测试几组常见 `PIP_INDEX_URL / UV_INDEX_URL`，输出每组的索引访问时间和一个小文件下载时间，并给出推荐配置。

这样本地开发仍然保留 `uvicorn + pnpm dev` 的节奏，但代码题在线运行会走 Docker 判题环境。

## 环境变量策略

敏感信息不进 git，不随本地打包上传。

- 本地打包时显式排除：
  - `backend/.env`
  - `frontend/.env*`
  - `deploy/env/backend.env`
  - `deploy/env/database.env`

- 服务器持久保存位置：
  - `/home/leishuo/exam-app/shared/env/backend.env`
  - `/home/leishuo/exam-app/shared/env/database.env`
  - `/home/leishuo/exam-app/shared/env/deploy.env`

## Docker Hub 拉取超时

如果服务器执行部署时报类似下面的错误：

```text
failed to resolve reference "docker.io/library/postgres:17-alpine"
```

说明远程服务器访问 Docker Hub 超时。处理方式是编辑：

```bash
/home/leishuo/exam-app/shared/env/deploy.env
```

写入镜像代理，例如：

```bash
COMPOSE_PROJECT_NAME=exam-app
POSTGRES_IMAGE=docker.m.daocloud.io/library/postgres:17-alpine
NGINX_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine
PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim
NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:22-alpine
FRONTEND_NGINX_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine
DEBIAN_APT_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/debian
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
PNPM_REGISTRY=https://registry.npmmirror.com
```

保存后重新执行 `./scripts/deploy.sh`。

注意：服务器系统是 Ubuntu 不影响这里的 `DEBIAN_APT_MIRROR`。这是因为后端容器基础镜像 `python:3.12-slim` 内部是 Debian 系，`apt-get` 发生在容器构建阶段，而不是直接操作宿主机 Ubuntu。

## 未来接入域名 / HTTPS

当前 Nginx 直接监听 `3036` 端口，适合没有域名的阶段。

未来切换到域名时，调整：

1. 修改 `deploy/nginx/default.conf.template`
   - `listen 3036` -> `listen 80`
   - 增加 `listen 443 ssl`
   - `server_name _` -> 真实域名

2. 给 nginx 服务增加证书挂载

3. 在模板中增加 80 -> 443 跳转

4. 将 `EXAM_CORS_ORIGINS` 更新为真实域名地址


## 学习通随部署自动启用

首次补齐本功能使用：

```bash
./scripts/deploy.sh --target backend
# 如需同时发布本地前端改动：
./scripts/deploy.sh --target app
```

仅部署 `frontend` 不会安装后端浏览器或更改开关。后端发布时自动执行：

1. 服务器 `shared/env/backend.env` 没有学习通开关时追加 `EXAM_CHAOXING_ENABLED=true`，不覆盖其他配置或密钥。已有显式 `false` 时保留，需管理员自行改为 `true`。
2. 后端镜像使用锁定依赖安装 Playwright、BeautifulSoup、Chromium 及 Linux 库。浏览器安装在 `/ms-playwright`，不依赖开发机缓存。
3. 在新镜像启动一个临时容器验证 Chromium 能运行，检查失败则不会停止在线后端，也不会运行本次迁移。
4. 启用学习通时自动使用一个 API worker。蓝绿槽位共用浏览器进程锁，并在旧后端停止后再启动新后端；不同时运行两个连接器或评分消费者。
5. 新后端启动或切流检查失败时，尝试恢复保留的旧容器及 Nginx 配置；数据库迁移不会自动回退。

学习通启用后的后端发布会短暂中断 API、清除学习通临时登录，建议安排在无正在进行考试/评分的时段。保存的答卷和评分结果不受临时登录丢失影响；重启打断且未确定完成的模型调用可能需要人工重试。纯前端发布不会重启学习通后端。

若 Chromium 下载受限，在服务器 `shared/env/deploy.env` 设置 `CHROMIUM_FOR_TESTING_DOWNLOAD_HOST`；当前默认值为 `https://cdn.npmmirror.com/binaries/chrome-for-testing`，目录结构必须为 `/<版本>/<平台>/<文件>`，例如 `153.0.8010.12/linux64/chrome-linux64.zip`。构建直接下载该归档，不让 Playwright 添加 `builds/cft/` 前缀；镜像失败时自动重试官方 CDN。不要把本地 macOS 的 `EXAM_CHAOXING_BROWSER_EXECUTABLE` 路径填入服务器配置。
