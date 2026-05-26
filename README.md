# 智评线

智评线是一个面向教学考试、通用测评与岗位能力建模的前后端分离系统。当前代码同时覆盖教师/评测者工作台、题库与知识库、考试与练习、AI 阅卷、学生/考生端作答、岗位模型和部署运维能力。

## 核心能力

- 账号与权限：支持平台管理员、学校管理员、企业管理员、企业用户、教师、学生、`evaluator`、`assessee` 等角色，并通过 RBAC 与 persona 区分教学考试和通用测评场景。
- 题库管理：题目增删改查、标签、题库、批量导入、DOCX/PDF/图片识别、AI 出题、知识点自动识别。
- 知识库管理：专业、方向、主知识/技能、子知识树，支持图片/目录导入、关系画布、资源关联和教学材料生成。
- 考试与练习：创建考试、发布练习、选择题目、选择考生、考试公开链接、考试分析和结果查看。
- 考生端：考试列表、移动端作答、代码题运行、错题本、申诉、首次登录强制改密。
- 阅卷中心：基于多模型角色链路的 AI 阅卷、人工确认、重评、操作日志和异常恢复。
- 岗位模型：`/gwmx` 入口下的岗位模型库、标准库、快速生成、企业模型复制、版本编辑和 AI 上传解析。
- 运维部署：Docker Compose、蓝绿发布、前后端分目标部署、独立 judge-runner 和 lsp-runner。

## 技术栈

- 前端：React 19、TypeScript、Vite 8、React Router 7、Refine、Radix UI、shadcn 风格组件、Tailwind CSS 4、TipTap、Monaco、Vitest、Playwright、PWA。
- 后端：FastAPI、SQLAlchemy Async、Alembic、PostgreSQL、asyncpg、uv、pytest、ruff、black。
- AI 与文件处理：DeepSeek、Qwen/Qwen-VL、OpenRouter/Claude、Kimi、Doubao、pdfplumber、python-docx、Mammoth、pdfjs、xlsx。
- 容器化：Docker、Docker Compose、Nginx、PostgreSQL 17、独立代码运行服务、独立 LSP 服务。

## 项目结构

```text
.
├── backend/                 # FastAPI 后端、Alembic、runner 服务和数据脚本
│   ├── src/app/             # 业务模块
│   ├── alembic/             # 数据库迁移
│   ├── scripts/             # 初始化、导入、种子数据脚本
│   ├── Dockerfile
│   ├── judge-runner.Dockerfile
│   └── lsp-runner.Dockerfile
├── frontend/                # React + Vite 前端
│   ├── src/pages/           # 主要页面
│   ├── src/components/      # 公共组件
│   ├── Dockerfile
│   └── package.json
├── deploy/                  # 线上环境变量示例与 Nginx 模板
├── docs/                    # 规格、计划、导入材料与设计文档
├── scripts/deploy.sh        # 一键上传与蓝绿部署脚本
├── docker-compose.yml       # 生产部署 Compose
└── docker-compose.dev.yml   # 本地 runner Compose
```

## 环境要求

- macOS/Linux
- Docker Desktop 或 Docker Engine
- Python 3.12+
- uv
- Node.js 22+
- pnpm 10.33.0，项目已在 `frontend/package.json` 固定 `packageManager`

安装示例：

```bash
brew install uv
corepack enable
corepack prepare pnpm@10.33.0 --activate
```

## 本地开发

### 1. 准备数据库

后端默认连接：

```text
postgresql+asyncpg://exam:exam@localhost:5432/exam
```

如果本地没有 PostgreSQL，可以直接用 Docker 启动一个：

```bash
docker run --name exam-db \
  -e POSTGRES_DB=exam \
  -e POSTGRES_USER=exam \
  -e POSTGRES_PASSWORD=exam \
  -p 5432:5432 \
  -v exam_postgres_data:/var/lib/postgresql/data \
  -d postgres:17-alpine
```

如果容器已经存在但停止了：

```bash
docker start exam-db
docker exec exam-db pg_isready -U exam -d exam
```

### 2. 配置后端环境变量

```bash
cp backend/.env.example backend/.env
```

常用配置：

```env
EXAM_DATABASE_URL=postgresql+asyncpg://exam:exam@localhost:5432/exam
EXAM_SECRET_KEY=dev-secret-key
EXAM_DEBUG=true
EXAM_CORS_ORIGINS=["http://localhost:4000"]
EXAM_FRONTEND_BASE_URL=http://localhost:4000
EXAM_JUDGE_RUNNER_URL=http://127.0.0.1:8010
EXAM_LSP_RUNNER_URL=http://127.0.0.1:8020
```

AI、SMTP、OIDC 等配置按需填写。不要提交真实 `.env`、API Key 或邮箱授权码。

### 3. 启动后端

```bash
cd backend
uv sync --extra dev
PYTHONPATH=src uv run alembic upgrade head
PYTHONPATH=src uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

健康检查：

```bash
curl -i http://127.0.0.1:8000/api/health
```

应用启动时会自动创建表结构并幂等 seed RBAC 权限、角色、AI 阅卷默认配置和提示词模板；Alembic 仍是推荐的正式迁移方式。

### 4. 创建平台管理员

```bash
cd backend
PYTHONPATH=src uv run python scripts/create_platform_admin.py \
  --username admin \
  --password admin123 \
  --full-name "Platform Admin"
```

### 5. 启动前端

```bash
cd frontend
pnpm install --frozen-lockfile
API_URL=http://localhost:8000 pnpm dev
```

前端默认地址：

```text
http://localhost:4000
```

Vite 会把 `/api` 代理到 `API_URL`。

### 6. 启动代码运行和 LSP 服务

代码题运行和代码编辑器语言服务由独立容器提供。按需启动：

```bash
docker compose -f docker-compose.dev.yml up -d judge_runner
docker compose -f docker-compose.dev.yml up -d lsp_runner
```

健康检查：

```bash
curl -i http://127.0.0.1:8010/health
curl -i http://127.0.0.1:8020/health
```

## 常用命令

### 前端

```bash
cd frontend
pnpm dev
pnpm build
pnpm lint
pnpm exec tsc -b --pretty false
pnpm exec vitest run
pnpm exec playwright test
```

### 后端

```bash
cd backend
uv sync --extra dev
PYTHONPATH=src uv run alembic upgrade head
PYTHONPATH=src uv run pytest
PYTHONPATH=src uv run ruff check .
PYTHONPATH=src uv run black --check .
```

### 数据与种子脚本

```bash
cd backend
PYTHONPATH=src uv run python scripts/seed_knowledge_base.py
PYTHONPATH=src uv run python scripts/seed_question_banks.py
PYTHONPATH=src uv run python scripts/seed_questions.py
PYTHONPATH=src uv run python scripts/seed_standard_job_models.py
```

具体脚本是否适用于当前数据库，执行前先阅读对应文件。

## 主要访问入口

- 登录：`/login`
- 注册：`/register`
- 管理工作台：`/dashboard`
- 学生/考生工作台：`/student`
- 题库管理：`/questions`
- 导入题目：`/questions/import`
- AI 出题：`/questions/ai-generate`
- 知识库管理：`/knowledge`
- 考试管理：`/exams`
- 试卷管理：`/papers`
- 阅卷中心：`/grading`
- 学生管理/考生管理：`/students`
- 模型设置：`/settings/model`
- 岗位模型入口：`/gwmx`
- 岗位模型工作台：`/gwmx/workbench`
- 岗位模型列表：`/gwmx/job-models`
- 外部邀请考试：`/exam-invite`
- 公开考试入口：`/exam-public`

## 部署

项目提供本地打包、上传服务器、远程构建、迁移、健康检查、Nginx 切流的一键脚本：

```bash
./scripts/deploy.sh
```

默认部署目标：

```text
leishuo@146.56.224.80
APP_ROOT=/home/leishuo/exam-app
DEPLOY_PORT=3036
```

部署后访问：

```text
http://146.56.224.80:3036
```

### 部署目标

```bash
./scripts/deploy.sh --target all          # 默认，前端 + 后端 + runners
./scripts/deploy.sh --target app          # 前端 + 后端，不动 runners
./scripts/deploy.sh --target frontend     # 只部署前端并切换前端 slot
./scripts/deploy.sh --target backend      # 只部署后端、迁移并切换后端 slot
./scripts/deploy.sh --target judge-runner # 只部署代码运行服务
./scripts/deploy.sh --target lsp-runner   # 只部署 LSP 服务
./scripts/deploy.sh --target runners      # 部署 judge-runner + lsp-runner
```

也可以通过环境变量覆盖：

```bash
DEPLOY_HOST=1.2.3.4 DEPLOY_USER=ubuntu DEPLOY_PORT=3036 ./scripts/deploy.sh -t app
```

### 线上环境变量文件

首次部署会在服务器生成示例文件并停止，填写后重新部署：

```text
/home/leishuo/exam-app/shared/env/backend.env
/home/leishuo/exam-app/shared/env/database.env
/home/leishuo/exam-app/shared/env/deploy.env
```

这些文件不会从本地上传，也不应该提交到仓库。示例模板在：

```text
deploy/env/backend.env.example
deploy/env/database.env.example
deploy/env/deploy.env.example
```

### 蓝绿发布说明

`docker-compose.yml` 中前端和后端都有 `blue` / `green` 两组服务。部署时脚本会构建非当前活动 slot，健康检查通过后更新 Nginx upstream，再停止旧 slot。

活动 slot 记录在服务器：

```text
/home/leishuo/exam-app/shared/nginx/active_backend_slot
/home/leishuo/exam-app/shared/nginx/active_frontend_slot
```

这样可以支持前端单独部署、后端单独部署，以及前后端一起部署。

### Nginx 与未来 HTTPS

当前线上 Nginx 监听 `3036`，模板在：

```text
deploy/nginx/default.conf.template
```

未来接入域名和 HTTPS 时，按模板注释切换到 80/443、配置 `server_name`、挂载证书，并添加 HTTP 到 HTTPS 跳转。

## 配置参考

后端所有配置使用 `EXAM_` 前缀，核心项如下：

| 变量 | 说明 |
| --- | --- |
| `EXAM_DATABASE_URL` | PostgreSQL asyncpg 连接串 |
| `EXAM_SECRET_KEY` | JWT 密钥 |
| `EXAM_CORS_ORIGINS` | 前端来源列表 |
| `EXAM_FRONTEND_BASE_URL` | 邮件重置链接、跳转等使用的前端地址 |
| `EXAM_JUDGE_RUNNER_URL` | 代码运行服务地址 |
| `EXAM_LSP_RUNNER_URL` | LSP 服务地址 |
| `EXAM_DEEPSEEK_API_KEY` | DeepSeek API Key |
| `EXAM_QWEN_API_KEY` | Qwen API Key |
| `EXAM_QWEN_VL_MODEL_NAME` | Qwen 视觉模型，用于图片/目录识别 |
| `EXAM_OPENROUTER_API_KEY` | OpenRouter/Claude API Key |
| `EXAM_DOUBAO_API_KEY` | Doubao API Key，默认仲裁关闭 |
| `EXAM_SMTP_*` | 找回密码邮件配置 |
| `EXAM_OIDC_*` | ArkLoop/OIDC SSO 配置，未配置 issuer 时关闭 |

## 数据权限和角色约定

- 平台管理员可管理全局用户、角色、数据和运维页面。
- 教师/`evaluator` 管理自己的学生/考生、题库、知识点、考试与试卷。
- 学生/`assessee` 进入考生端，只查看自己的考试、结果、错题和通知。
- 题库与知识点默认私有，只有显式平台公开后其他教师/评测者才可见。
- 考试和学生/考生数据始终是私有或按考试邀请关系可见，不作为平台共享数据。
- 企业/学校角色主要服务岗位模型与企业招聘/培训测评场景。

## 常见问题

### 后端启动时报 `ConnectionRefusedError`

通常是 `EXAM_DATABASE_URL` 指向的 PostgreSQL 没启动。

```bash
lsof -nP -iTCP:5432 -sTCP:LISTEN
docker ps --filter name=exam-db
docker start exam-db
docker exec exam-db pg_isready -U exam -d exam
```

### PostgreSQL 报 `No space left on device`

Docker 或宿主机磁盘满会导致数据库无法写 checkpoint 或 `postmaster.pid`。

```bash
df -h /System/Volumes/Data
docker system df
docker builder prune -f
docker start exam-db
```

不要删除数据库 volume，除非你明确要清空本地数据。

### Docker 构建前端时报 `ERR_PNPM_IGNORED_BUILDS`

项目已固定 `pnpm@10.33.0`，并在 `frontend/package.json` 允许 `esbuild` 执行 build script。若仍遇到该错误，确认服务器使用的是最新代码，并重新部署前端：

```bash
./scripts/deploy.sh -t frontend
```

### Docker Hub 或依赖下载超时

在服务器的 `/home/leishuo/exam-app/shared/env/deploy.env` 配置镜像源，例如：

```env
POSTGRES_IMAGE=docker.m.daocloud.io/library/postgres:17-alpine
NGINX_IMAGE=docker.m.daocloud.io/library/nginx:1.27-alpine
PYTHON_BASE_IMAGE=docker.m.daocloud.io/library/python:3.12-slim
NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:22-alpine
PNPM_REGISTRY=https://registry.npmmirror.com
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
UV_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
GOPROXY=https://goproxy.cn,direct
```

### 找回密码邮件不发送

检查 `EXAM_SMTP_HOST`、`EXAM_SMTP_USERNAME`、`EXAM_SMTP_PASSWORD`、`EXAM_SMTP_FROM_EMAIL`。QQ 邮箱需要使用授权码，不是登录密码。

## 代码质量建议

提交或部署前建议至少执行：

```bash
cd frontend && pnpm build
cd ../backend && PYTHONPATH=src uv run pytest
```

针对单个改动，可以运行对应测试文件，例如：

```bash
cd frontend && pnpm exec vitest run src/pages/questions/import.test.tsx
cd backend && PYTHONPATH=src uv run pytest tests/test_student_flow.py -q
```

## 相关文档

- 部署说明：[docs/deployment-docker-compose.md](/Users/jzefan/work/proj/exam/docs/deployment-docker-compose.md)
- 设计与实现计划：[docs/superpowers](/Users/jzefan/work/proj/exam/docs/superpowers)
- 需求与资料：[docs](/Users/jzefan/work/proj/exam/docs)
