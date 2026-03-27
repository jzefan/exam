# Exam

一个前后端分离的考试系统项目，包含题库管理、知识点管理、考试编排，以及学生端考试作答流程。

## 技术栈

- 前端：React 19、TypeScript、Vite、Refine、Radix UI、UnoCSS、TipTap
- 后端：FastAPI、SQLAlchemy Async、Alembic、PostgreSQL
- 开发环境：Docker Compose、pnpm、uv

## 项目结构

```text
.
├── frontend/    # React + Vite 前端
├── backend/     # FastAPI 后端
├── design/      # 设计稿与界面参考
├── docs/        # 方案和设计文档
├── scripts/     # 项目辅助脚本
└── docker-compose.yml
```

## 快速启动

### 方式一：Docker Compose

这是最省事的本地启动方式，会同时启动 Postgres、后端和前端。

```bash
docker-compose up --build
```

启动后默认地址：

- 前端：http://localhost:4000
- 后端：http://localhost:8000
- 健康检查：http://localhost:8000/api/health

### 方式二：本地分别启动

#### 1. 启动数据库

需要本地可用的 PostgreSQL，并创建一个数据库，例如 `exam`。

#### 2. 启动后端

进入后端目录：

```bash
cd backend
```

安装依赖：

```bash
uv sync
```

运行数据库迁移：

```bash
uv run alembic upgrade head
```

启动开发服务器：

```bash
EXAM_DATABASE_URL=postgresql+asyncpg://exam:exam@localhost:5432/exam \
EXAM_SECRET_KEY=dev-secret-key \
EXAM_DEBUG=true \
uv run uvicorn app.main:app --app-dir src --reload
```

#### 3. 启动前端

进入前端目录：

```bash
cd frontend
```

安装依赖：

```bash
pnpm install
```

启动开发服务器：

```bash
API_URL=http://localhost:8000 pnpm dev
```

前端开发服务器默认运行在 `http://localhost:4000`，并通过 Vite 代理把 `/api` 请求转发到后端。

## 常用命令

### 前端

```bash
cd frontend
pnpm dev
pnpm build
pnpm lint
pnpm preview
```

### 后端

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run pytest
uv run ruff check .
uv run black --check .
```

## 配置说明

后端通过 `EXAM_` 前缀环境变量读取配置，核心项包括：

- `EXAM_DATABASE_URL`：数据库连接串
- `EXAM_SECRET_KEY`：JWT 密钥
- `EXAM_CORS_ORIGINS`：允许的前端来源
- `EXAM_DEBUG`：是否开启调试模式

此外，项目还预留了 DeepSeek、Qwen、Kimi 等 AI 服务配置项，按需设置即可。

## 主要功能模块

- 用户与认证
- 题目、标签、题库管理
- 知识点与知识图谱管理
- 考试与岗位维度配置
- 学生端考试作答界面
- 富文本内容编辑与导入能力

## 测试与现状

- 后端已包含部分认证与学习模块测试
- 当前仓库根目录原先缺少统一的项目说明，前端 `README` 仍是默认 Vite 模板
- 如果要继续完善协作体验，建议补充：
  - 统一的环境变量示例文件
  - 初始化测试数据脚本说明
  - 默认管理员账号或种子数据用法

## 相关文档

- 设计说明：[design/DESIGN.md](/Users/jzefan/work/proj/exam/design/DESIGN.md)
- 产品文档：[prd.md](/Users/jzefan/work/proj/exam/prd.md)
- 方案文档：[docs](/Users/jzefan/work/proj/exam/docs)
