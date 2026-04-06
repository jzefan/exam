# 岗位能力模型生成平台 - 设计文档

**日期**: 2026-04-02
**状态**: Draft
**项目**: exam (集成模块)

## 概述

将"岗位模型快速生成工具"作为新模块集成到现有 exam 项目中，利用 AI 技术将非结构化的招聘/标准文档转化为结构化的、可教学的能力图谱，并支持映射到学校课程体系。

### 核心目标

输入企业 JD、岗位说明书、国家职业标准 → 输出结构化、分级化的岗位能力模型（含知识点）→ 映射到学校课程体系。

### 目标用户

- **企业端**: HR、技术总监（招聘标准制定、内部培训大纲）
- **学校端**: 专业负责人、教务处长（人才培养方案修订、课程开发）
- **平台管理员**: 维护行业知识图谱、标准库

### 关键决策

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 集成方式 | 集成到现有 exam 项目 | 复用用户系统、知识图谱、文档导入等基础设施 |
| 实现范围 | 全量实现 | 包含模板库、版本控制、多租户、报告导出等 |
| 多租户 | 简化版组织隔离 | 通过 org_id 做数据过滤，逻辑隔离 |
| AI 层 | LLM API + pgvector | 用 LLM 做核心解析，pgvector 做语义搜索 |
| 能力树编辑 | 树形列表 + 图谱视图结合 | 树形做日常编辑，图谱做全局可视化 |
| 权限体系 | 完整 RBAC | 角色-权限矩阵，支持灵活权限配置 |
| 接口标准 | 不绑定标准 | 按业务需求自由设计，后续有需求再适配 |
| 实现路径 | 渐进式集成（方案 A） | 按模块逐步集成，每步可验证 |

---

## 第1部分：RBAC 权限体系 + 组织模型

### 数据模型

```
Organization
├── id (UUID)
├── name (组织名称)
├── type (enterprise / school)
├── description
├── logo_url
├── is_active
└── timestamps

Role
├── id (UUID)
├── name (角色名, 如 "enterprise_admin", "teacher")
├── display_name (显示名)
├── description
├── is_system (系统内置角色不可删除)
└── org_id (NULL = 全局角色, 非NULL = 组织自定义角色)

Permission
├── id (UUID)
├── resource (资源, 如 "exam", "job_model", "question")
├── action (操作, 如 "create", "read", "update", "delete")
└── description

RolePermission (多对多)
├── role_id
└── permission_id

UserOrganization (用户-组织关系)
├── user_id
├── org_id
├── role_id (用户在该组织下的角色)
└── is_primary (主要组织)
```

### 内置角色

| 角色 | 组织类型 | 主要权限 |
|------|---------|---------|
| `platform_admin` | 全局 | 全部权限，管理组织/用户/知识图谱 |
| `enterprise_admin` | 企业 | 管理本组织岗位模型、成员、导出报告 |
| `enterprise_user` | 企业 | 查看/编辑岗位模型 |
| `school_admin` | 学校 | 管理课程库、查看岗位模型、缺口分析 |
| `teacher` | 学校 | 课程映射、考试管理 |
| `student` | 学校 | 参加考试、查看学习路径 |

### 对现有系统的影响

- 现有 `User.role` 枚举字段迁移到 `UserOrganization.role_id`
- 创建默认组织，将现有用户迁入
- 现有路由的权限检查从 `role == "admin"` 改为权限查询
- 向后兼容：迁移脚本保证现有数据不丢失

### 权限检查方式

```python
@require_permission("job_model", "create")
async def create_job_model(...):
    ...
```

---

## 第2部分：岗位模型核心数据模型

### 数据模型

```
JobModelProject (建模项目/工作台)
├── id (UUID)
├── name (项目名称, 如 "2024新能源汽车嵌入式工程师")
├── industry (行业标签, 如 "智能网联汽车")
├── description
├── org_id → Organization
├── created_by → User
├── status (draft / generating / review / published / archived)
└── timestamps

JobModel (岗位能力模型 - 支持版本控制)
├── id (UUID)
├── project_id → JobModelProject
├── job_role (岗位名称, 如 "嵌入式软件工程师")
├── version (整数递增, 1, 2, 3...)
├── version_note (版本说明)
├── is_current (当前生效版本)
├── source_type (ai_generated / manual / template)
├── raw_content (AI 原始生成的 JSON, 留存用于回溯)
└── timestamps

CompetencyDimension (能力维度)
├── id (UUID)
├── model_id → JobModel
├── name (如 "专业技术能力", "工程实践能力", "职业素养")
├── description
├── sort_order
└── timestamps

Skill (技能项)
├── id (UUID)
├── dimension_id → CompetencyDimension
├── name (如 "C语言编程")
├── level (L1了解 / L2熟悉 / L3掌握 / L4精通 / L5专家)
├── description
├── sort_order
└── timestamps

SkillKnowledgePoint (技能下的知识点)
├── id (UUID)
├── skill_id → Skill
├── name (如 "指针与内存管理")
├── teaching_suggestion (教学建议)
├── difficulty (入门 / 初级 / 中级 / 高级 / 困难)
├── sort_order
└── timestamps

SourceDocument (上传的源文档)
├── id (UUID)
├── project_id → JobModelProject
├── file_name
├── file_path
├── file_type (pdf / word / txt / excel)
├── extracted_text (OCR/解析后的纯文本)
├── uploaded_by → User
└── timestamps
```

### 与现有系统的关联

```
SkillKnowledgePoint ──映射──→ KnowledgePoint (现有知识图谱)
  通过 skill_kp_mapping 关联表:
  ├── skill_kp_id → SkillKnowledgePoint
  ├── knowledge_point_id → KnowledgePoint (现有)
  ├── match_type (auto / manual)
  └── confidence (AI 匹配置信度, 0-1)
```

### 版本控制机制

- 每次编辑发布时创建新版本（`version` +1），旧版本 `is_current = False`
- 可回溯任意历史版本
- `raw_content` 保留 AI 原始输出，仅做存档和对比用途。所有编辑操作修改的是关系表数据（CompetencyDimension / Skill / SkillKnowledgePoint），不修改 `raw_content`

### 模板库

```
JobModelTemplate (行业模板)
├── id (UUID)
├── name (如 "通用软件工程师模板")
├── industry
├── template_data (JSON, 完整的能力模型结构)
├── is_system (系统预置 vs 用户沉淀)
├── usage_count
├── created_by → User
└── timestamps
```

模板来源：
- 系统预置：冷启动时人工录入的 5-10 个"黄金模型"
- 用户沉淀：已发布的岗位模型可"另存为模板"

---

## 第3部分：AI 解析管线

### 整体流程

```
文档上传 → 文本提取 → Prompt链处理 → 结构化输出 → 人工校准
                          ↑
                    pgvector 语义匹配
                    (标准知识库检索)
```

### 步骤拆解

**Step 1: 文本提取**

- PDF: `pypdf2` / `pdfplumber`
- Word: `python-docx`（现有能力已有 mammoth）
- 图片/扫描件: 调用 LLM 多模态能力（DeepSeek-VL / Qwen-VL）做 OCR
- 输出：纯文本存入 `SourceDocument.extracted_text`

**Step 2: Prompt 链（4步串行）**

```
[提取] 从文本中识别：岗位名称、行业、技能要求、工具/技术栈、
       软素质、证书要求、工作职责
         ↓
[清洗] 去重、统一术语（如 "JS" → "JavaScript"）、
       合并同义表达（如 "团队协作" = "团队合作能力"）
         ↓
[拆解] 将宏观技能拆解为微观知识点
       如 "Python编程" → ["列表推导式", "装饰器", "异步编程", ...]
         ↓
[分级] 根据 JD 上下文为每个技能标注 L1-L5 等级，
       为知识点标注难度和教学建议
```

每步是独立的 LLM 调用，中间结果以 JSON 传递，方便调试和重试单步。

**Step 3: pgvector 语义匹配**

```
VectorKnowledgeBase (标准知识库向量表)
├── id (UUID)
├── content (原文, 如 "BLDC无刷直流电机驱动控制")
├── category (技能 / 知识点 / 证书 / 工具)
├── industry (行业)
├── standard_name (对齐后的标准术语)
├── embedding (vector(1536))
├── source (来源, 如 "人社部职业标准-电气工程师")
└── timestamps
```

匹配流程：

1. AI 提取出的每个技能/知识点 → 生成 embedding
2. 在 `VectorKnowledgeBase` 中做相似度搜索（余弦距离 < 阈值）
3. 命中 → 用标准术语替换（如 "画板子" → "PCB设计"）
4. 未命中 → 标记为"新术语"，保留原文，提示人工确认

**Step 4: 结构化输出**

AI 最终输出符合 `JobModel` 数据结构的 JSON，写入数据库，状态设为 `review`（待人工校准）。

### 异步处理

- AI 解析是耗时操作（可能 30s-2min）
- 使用后台任务（FastAPI BackgroundTasks 或 Celery）
- 前端轮询/WebSocket 获取进度
- 支持单步重试（如只重新执行"拆解"步骤）

### Prompt 模板管理

```
PromptTemplate
├── id (UUID)
├── name (如 "extract_skills_v2")
├── step (extract / clean / decompose / grade)
├── industry (NULL = 通用, 非NULL = 行业专用)
├── template (Prompt 模板文本, 含变量占位符)
├── is_active
└── timestamps
```

行业差异通过不同的 Prompt 模板解决（如护理 vs 编程使用不同的拆解逻辑）。

---

## 第4部分：能力树编辑器 + 图谱视图

### 双视图架构

```
┌─────────────────────────────────────────────┐
│  工具栏: [树形视图] [图谱视图] [保存] [发布]    │
├──────────────────┬──────────────────────────┤
│                  │                          │
│  左侧: 能力树    │  右侧: 详情/属性面板      │
│  (日常编辑)      │  (选中节点的属性编辑)      │
│                  │                          │
├──────────────────┴──────────────────────────┤
│  底部状态栏: 节点数 | 版本 | 最后保存时间       │
└─────────────────────────────────────────────┘
```

### 视图一：树形列表（主编辑视图）

可折叠的树形结构：

```
📁 嵌入式软件工程师
├── 📂 专业技术能力
│   ├── 🔧 C语言编程 [L4 精通]
│   │   ├── 📝 指针与内存管理 (中级)
│   │   ├── 📝 中断服务程序编写 (高级)
│   │   └── 📝 多任务调度机制 (高级)
│   └── 🔧 嵌入式Linux [L3 掌握]
│       └── ...
├── 📂 工程实践能力
│   └── ...
└── 📂 职业素养
    └── ...
```

**交互操作**：

- 拖拽排序/移动节点（跨维度移动技能），使用 `@dnd-kit`
- 右键菜单：新增/删除/合并/拆分节点
- 内联编辑：双击修改名称、点击等级标签切换 L1-L5
- 批量操作：多选后批量设置等级/难度
- 搜索/过滤：按关键词或等级筛选

### 视图二：图谱视图（全局可视化）

复用现有 `@xyflow/react` 基础设施：

```
┌──────────┐     ┌──────────┐     ┌────────────────┐
│ 岗位角色  │────→│ 能力维度  │────→│ 技能 (含等级)   │
└──────────┘     └──────────┘     └───────┬────────┘
                                          │
                                   ┌──────┴──────┐
                                   │  知识点节点   │
                                   │ (含难度颜色)  │
                                   └─────────────┘
```

- 节点颜色编码：L1-L5 用不同色阶表示
- 点击节点 → 右侧属性面板展示详情
- 支持缩放、平移、自动布局
- 展示知识点与课程的映射关系连线

### 右侧属性面板

根据选中节点类型动态切换：

- **维度**: 名称、描述、包含技能数量
- **技能**: 名称、描述、等级（L1-L5）、关联知识点列表、AI 匹配标准术语
- **知识点**: 名称、难度、教学建议、映射课程、来源标记（AI / 人工）

### 自动保存

- 编辑操作 debounce 2s 后自动保存（draft 状态）
- "发布"按钮创建新版本

---

## 第5部分：课程映射 + 缺口分析

### 课程数据模型

```
Course (课程库 - 学校端维护)
├── id (UUID)
├── org_id → Organization (学校)
├── name (如 "嵌入式C语言基础")
├── code (课程编号)
├── category (通识 / 专业基础 / 专业核心 / 实践)
├── credit (学分)
├── hours (学时)
├── description
├── semester (建议学期)
└── timestamps

CourseKnowledgePoint (课程覆盖的知识点)
├── id (UUID)
├── course_id → Course
├── knowledge_point_id → KnowledgePoint (现有知识图谱)
├── coverage_level (L1-L5)
└── timestamps

SkillCourseMapping (技能知识点 → 课程映射)
├── id (UUID)
├── skill_kp_id → SkillKnowledgePoint
├── course_id → Course
├── match_type (auto / manual)
├── confidence (AI 匹配置信度)
└── timestamps
```

### 自动匹配流程

```
岗位模型知识点
       ↓
  1. 精确匹配: skill_kp_mapping 中已有映射到现有 KnowledgePoint
       ↓ (未命中)
  2. 语义匹配: pgvector 搜索课程知识点 embedding
       ↓
  置信度 > 0.8 → 自动关联
  置信度 0.5-0.8 → 建议关联（需确认）
  置信度 < 0.5 → 标记未匹配
```

### 缺口分析

```
GapAnalysis (缺口分析报告)
├── id (UUID)
├── model_id → JobModel
├── org_id → Organization (学校)
├── analysis_data (JSON)
├── generated_at
└── timestamps
```

**analysis_data 结构**：

```json
{
  "summary": {
    "total_kp": 45,
    "covered": 32,
    "partial": 8,
    "missing": 5,
    "coverage_rate": 0.71
  },
  "dimension_breakdown": [
    {
      "dimension": "专业技术能力",
      "coverage_rate": 0.85,
      "gaps": []
    }
  ],
  "gaps": [
    {
      "skill_kp_id": "...",
      "kp_name": "CAN总线协议",
      "required_level": "L3",
      "current_level": null,
      "gap_type": "missing",
      "suggestion": "建议新增《车载网络通信》课程"
    },
    {
      "kp_name": "多任务调度机制",
      "required_level": "L4",
      "current_level": "L2",
      "gap_type": "depth_insufficient",
      "suggestion": "建议将RTOS应用课程从选修调整为必修，增加实验学时"
    }
  ],
  "new_course_suggestions": [
    {
      "name": "车载网络通信",
      "covers": ["CAN总线协议", "LIN总线", "车载以太网"],
      "suggested_hours": 48,
      "suggested_semester": 5
    }
  ]
}
```

### 缺口可视化

覆盖率仪表盘（按维度展示）+ 对比表格视图（左列岗位要求，右列课程覆盖，缺口高亮红色）。建议由 AI 生成并可人工修改。

---

## 第6部分：报告导出 + 招聘JD生成

### 导出格式

**JSON**: 直接输出 `JobModel` 完整数据结构，供系统间对接。

**Excel**:

- Sheet 1: 模型概览（岗位名称、行业、版本、生成日期）
- Sheet 2: 能力清单（维度 | 技能 | 等级 | 知识点 | 难度 | 教学建议）
- Sheet 3: 课程映射（知识点 | 映射课程 | 匹配方式 | 覆盖度）
- Sheet 4: 缺口分析（缺口项 | 类型 | 建议措施）

**PDF**: 使用 `weasyprint` 或 `reportlab` 生成可视化报告，含封面、能力模型树形图、覆盖率图表、缺口明细表、课程建议。

### 招聘JD反向生成

```
GeneratedJD
├── id (UUID)
├── model_id → JobModel
├── content (Markdown 格式的JD文本)
├── style (formal / casual / technical)
├── created_by → User
└── timestamps
```

基于已发布的岗位模型调用 LLM 反向生成结构化招聘 JD，包含：岗位职责、任职要求、技能要求（含等级描述）、加分项。

---

## 第7部分：路由与页面结构

### 后端路由

```
/api/organizations                          # 组织管理
/api/roles                                  # 角色权限管理
/api/courses                                # 课程库 CRUD

/api/job-models/projects                    # 建模项目 CRUD
/api/job-models/projects/{id}/documents     # 源文档管理
/api/job-models/projects/{id}/generate      # 触发AI生成
/api/job-models/projects/{id}/models        # 模型版本列表
/api/job-models/models/{id}                 # 模型详情/编辑
/api/job-models/models/{id}/publish         # 发布新版本
/api/job-models/models/{id}/mapping         # 课程映射
/api/job-models/models/{id}/gap-analysis    # 缺口分析
/api/job-models/models/{id}/export          # 导出
/api/job-models/models/{id}/generate-jd     # 生成招聘JD
/api/job-models/templates                   # 模板库

/api/vector-kb                              # 标准知识库管理
/api/prompt-templates                       # Prompt模板管理
```

### 前端页面

```
/admin/organizations              # 组织管理 (platform_admin)
/admin/roles                      # 角色权限管理

/job-models                       # 项目列表 (工作台)
/job-models/create                # 创建项目
/job-models/:projectId            # 项目详情
/job-models/:projectId/edit       # 编辑器 (树形+图谱双视图)
/job-models/:projectId/mapping    # 课程映射
/job-models/:projectId/gap        # 缺口分析
/job-models/:projectId/export     # 导出中心
/job-models/:projectId/history    # 版本历史

/courses                          # 课程库管理 (学校端)
/templates                        # 模板库浏览
/vector-kb                        # 知识库管理 (platform_admin)
```

---

## 实现顺序

| 阶段 | 模块 | 依赖 |
|------|------|------|
| 1 | RBAC 权限体系 + 组织模型 | 无（基础设施） |
| 2 | 岗位模型数据模型 + CRUD | 阶段 1 |
| 3 | 文档上传 + AI 解析管线 | 阶段 2 |
| 4 | 能力树编辑器 + 图谱视图 | 阶段 2 |
| 5 | pgvector 语义搜索 + 知识图谱匹配 | 阶段 3 |
| 6 | 课程映射 + 缺口分析 | 阶段 4, 5 |
| 7 | 模板库 + 版本控制 + 报告导出 + JD 生成 | 阶段 6 |

阶段 3 和 4 可并行开发。
