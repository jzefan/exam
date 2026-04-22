# Docker + Compose 自动化部署

这套部署方案面向服务器 `146.56.224.80`，入口地址为 `http://146.56.224.80:3036`。

## 方案概览

- 容器编排：Docker + docker compose
- 反向代理：Nginx
- 数据库：PostgreSQL
- 代码运行：judge-runner 独立容器
- 发布方式：本地 `scripts/deploy.sh` 打包 -> `scp` 上传 -> 服务器自动构建并切换
- 重启方式：蓝绿切换，先启动空闲槽位，再切流，最后关闭旧槽位

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

脚本自动完成：

1. 打包当前代码
2. `scp` 上传到服务器
3. 解压到新 release 目录
4. 构建空闲蓝绿槽位镜像
5. 运行数据库迁移
6. 启动空闲槽位
7. 健康检查
8. Nginx 切流
9. 下线旧槽位

## 代码运行环境

代码题在线运行不再依赖宿主机是否安装 `go`、`java` 等工具链，而是通过 compose 中的 `judge_runner` 容器统一提供：

- Python
- JavaScript / Node.js
- C
- C++
- Java
- Go

backend 容器通过内部地址 `http://judge_runner:8010` 调用该服务。

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
