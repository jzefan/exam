# Docker 判题运行环境设计

## 目标

为学生端代码题在线运行提供稳定、可复现的 Docker 判题环境，支持 `Python / JavaScript / C / C++ / Java / Go` 六种语言，不再依赖宿主机本地是否安装对应工具链。

## 现状问题

- 当前 `backend/src/app/code_runner/service.py` 直接在宿主机子进程里执行代码。
- 宿主机缺少 `go`、`javac`、`java` 时，会导致在线运行失败。
- 这类失败不应由学生承担，也不应要求部署机器手工补齐所有工具链。

## 方案对比

### 方案 A：把所有语言工具链直接装进 backend 容器

优点：
- 实现最直接

缺点：
- 业务 API 和代码执行混在一个容器里
- 后续做资源隔离、网络隔离、扩容都不舒服
- backend 镜像会明显变重

### 方案 B：新增独立 `judge-runner` 容器，由 backend 通过 HTTP 调用

优点：
- 业务接口和执行环境边界清楚
- 可以单独演进镜像、资源限制、健康检查
- 后续扩正式判题更自然

缺点：
- 要新增一个内部服务和容器编排

### 方案 C：每次运行动态 `docker run` 一次性容器

优点：
- 隔离最强

缺点：
- 接入复杂，调度与回收开销大
- 第一版明显过重

## 结论

采用 **方案 B**。

## 架构

### judge-runner 服务

新增一个独立 HTTP 服务，运行在 Docker 容器内：

- 复用现有 `app.code_runner` 逻辑
- 暴露：
  - `GET /health`
  - `POST /run`
- 容器内安装：
  - `python3`
  - `node`
  - `gcc`
  - `g++`
  - `openjdk`
  - `go`

### backend 接入方式

backend 新增配置：

- `EXAM_JUDGE_RUNNER_URL`
- 默认留空

运行逻辑：

1. 如果配置了 `EXAM_JUDGE_RUNNER_URL`
   - 通过 HTTP 把运行请求发送给 judge-runner
   - 读取统一结构结果
2. 如果没有配置
   - 继续走当前本机 `run_code()` 回退逻辑

这样本地开发和 Docker 部署都能兼容。

## 数据协议

judge-runner 直接复用现有代码运行协议：

- 请求：`CodeRunRequest + sample_tests`
- 响应：`CodeRunResult`

不重新发明接口结构，减少前后端改动。

## 容器编排

在 `docker-compose.yml` 中新增：

- `judge_runner`

特点：

- 基于独立 Dockerfile 构建
- 不对外暴露公网端口
- backend 通过内部服务名访问，例如 `http://judge_runner:8010`
- 增加健康检查

同时为 `backend_blue` / `backend_green` 注入：

- `EXAM_JUDGE_RUNNER_URL=http://judge_runner:8010`

## 安全与边界

第一版保持当前执行模型不变，不在本次设计里一次性引入重型沙箱系统，但判题环境至少做到：

- 运行发生在独立容器内
- judge-runner 不承载业务数据库逻辑
- 继续沿用现有超时与输出截断限制

本轮不做：

- 每次请求再启动子容器
- seccomp / rootless / 网络完全封锁等强化隔离

这些后续可以在独立迭代中继续增强。

## 测试策略

### backend

- 单元测试：
  - judge-runner HTTP 客户端请求成功
  - judge-runner 不可达时回退或报错行为
- API 测试：
  - 学生端 `run` 接口在启用 judge-runner 时仍返回原有结构

### judge-runner

- 健康检查测试
- `POST /run` 基础语言跑通测试

### Docker / compose

- 配置检查：
  - compose 中存在 `judge_runner`
  - backend 带有 `EXAM_JUDGE_RUNNER_URL`

## 迁移策略

这是一次增量接入，不涉及数据库迁移。

上线顺序：

1. 合并 judge-runner 服务和 compose 配置
2. 部署 Docker 环境
3. backend 自动改走 judge-runner
4. 学生端在线运行获得完整六语言支持

## 成功标准

- Docker compose 部署后，`Python / JavaScript / C / C++ / Java / Go` 六种语言都能在代码题中成功运行示例测试
- backend 不再依赖宿主机是否安装 Java / Go
- 学生端 `run` 接口响应结构保持兼容
