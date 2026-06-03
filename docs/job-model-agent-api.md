# Exam 智能体接口

本文档说明本项目对外部智能体开放的稳定集成接口。统一链路是：

```text
外部智能体
  -> MCP Server
    -> 本项目 REST/OpenAPI 或内部 service
      -> 业务权限 / 组织隔离 / 版本控制 / 审计
        -> PostgreSQL
```

当前推荐顺序是：

1. 外部业务系统使用 REST/OpenAPI。
2. 智能体客户端使用 MCP Server。
3. MCP Server 只调用 REST 接口，不直接访问数据库。

## 岗位模型 REST 接口

基础路径：

```text
/api/agent/job-models
```

认证方式：

```http
Authorization: Bearer <access_token>
X-Org-Id: <organization_id>
```

`X-Org-Id` 可省略，省略时使用当前用户主组织。

### 搜索岗位模型

```http
GET /api/agent/job-models?q=大数据&model_type=standard&_start=0&_end=20
```

支持参数：

- `q`：按岗位名称、岗位族、产业、方向搜索。
- `model_type`：例如 `standard`、`enterprise`。
- `industry_name`：产业名称。
- `direction_name`：产业方向。
- `_start` / `_end`：分页边界。

### 获取岗位模型详情

```http
GET /api/agent/job-models/{model_id}
```

返回当前版本、能力维度、技能和知识点。

### 导出岗位模型

```http
GET /api/agent/job-models/{model_id}/export?format=json
GET /api/agent/job-models/{model_id}/export?format=markdown
```

`markdown` 适合直接交给大模型阅读或生成报告。

### 推荐标准岗位

```http
POST /api/agent/job-models/recommend-standard
Content-Type: application/json

{
  "job_text": "负责低空产业大数据分析、数据治理和可视化..."
}
```

### 创建草稿

```http
POST /api/agent/job-models/drafts
Content-Type: application/json

{
  "job_role": "企业人工智能算法工程师",
  "model_type": "enterprise",
  "industry_name": "人工智能",
  "direction_name": "算法研发",
  "dimensions": [
    {
      "name": "算法工程能力",
      "skills": [
        {
          "name": "深度学习模型训练",
          "level": "L3",
          "knowledge_points": [
            { "name": "PyTorch 训练流程", "difficulty": "中级" }
          ]
        }
      ]
    }
  ]
}
```

### 结构预览

```http
POST /api/agent/job-models/{model_id}/structure-preview
Content-Type: application/json

{
  "dimensions": []
}
```

当前版本只返回当前结构和拟议结构的数量对比，不写入数据库。

### 替换草稿结构

```http
PUT /api/agent/job-models/{model_id}/structure
Content-Type: application/json

{
  "dimensions": [
    {
      "name": "数据平台开发",
      "skills": [
        {
          "name": "Flink 实时计算",
          "level": "L3",
          "knowledge_points": [{ "name": "窗口计算" }]
        }
      ]
    }
  ]
}
```

这个接口只允许更新 `draft` 状态的岗位模型。已发布模型需要先通过版本流程处理，避免智能体覆盖正式版本。

### 发布版本

```http
POST /api/agent/job-models/{model_id}/publish
Content-Type: application/json

{
  "version_note": "agent reviewed"
}
```

## MCP Server

启动命令：

```bash
cd backend
EXAM_AGENT_BASE_URL=http://localhost:8000 \
EXAM_AGENT_TOKEN=<access_token> \
EXAM_AGENT_ORG_ID=<organization_id> \
PYTHONPATH=src uv run python -m app.job_models.agent_mcp
```

可选环境变量：

- `EXAM_AGENT_BASE_URL`：后端地址，默认 `http://localhost:8000`。
- `EXAM_AGENT_TOKEN`：访问令牌，必填。
- `EXAM_AGENT_ORG_ID`：组织 ID，可选。
- `EXAM_AGENT_MCP_TRANSPORT`：默认 `stdio`，也可使用 SDK 支持的其它 transport。

### 岗位模型 MCP Tools

- `search_job_models`
- `get_job_model`
- `export_job_model`
- `recommend_standard_job_model`
- `create_draft_job_model`
- `preview_job_model_structure`
- `replace_draft_job_model_structure`
- `publish_job_model`

### Arkloop 智能组卷 MCP Tools

这些工具供 Arkloop 的“智能组卷”智能体使用。工具输入可以使用 Arkloop 侧较自然的字段，MCP Server 会转换为本项目当前后端 API 需要的格式。

- `exam_list_knowledge_points`：列出当前教师可见的知识点。
- `exam_list_question_banks`：列出当前教师可见的题库。
- `exam_ensure_course_question_bank`：确保教师有固定的“课程题库”，用于保存 AI 确认后的题目。
- `exam_list_questions`：按知识点、题型、难度读取可复用题目。
- `exam_save_questions`：保存老师确认后的 AI 题目，内部调用 `/api/questions/bulk`。
- `exam_create_paper`：按题目 ID 顺序创建试卷，内部调用 `/api/papers`。

题型映射：

- `single_choice` / `multi_choice` -> `choice`
- `true_false` / `judge` / `judgement` -> `true_false`
- `fill_in` / `short_answer` / `essay` / `code` 保持同名语义

难度映射：

- `easy` / `简单` -> `1`
- `medium` / `中等` -> `3`
- `hard` / `困难` -> `5`

### MCP Prompt

- `jd_to_job_model_prompt`

用于引导智能体先推荐标准岗位，再生成企业岗位模型草稿。

## 设计边界

- 外部智能体不直接访问数据库。
- Arkloop 等外部智能体不直接调用本项目数据库，也不把本项目内部 REST 细节暴露给最终教师。
- MCP 只做适配层，业务规则仍在 REST 后端或后端 service。
- 写操作先支持草稿、预览和显式发布。
- 后续如需批量覆盖结构，应先增加差异预览和审计日志，再开放真正写入。
