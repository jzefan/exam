# 知识点管理模块设计文档

**日期**: 2026-03-17
**状态**: 已批准
**模块**: 知识点管理（Knowledge Management）

---

## 一、背景与目标

本模块为考试系统的学习分析子系统提供知识点结构化管理能力。通过树形知识图谱，支持：

- 管理员/教师维护「专业 → 方向 → 知识点」层级结构
- 为题目、考试、学生能力分析提供知识点挂载点
- 可视化展示知识点间的父子关系与前置依赖关系

---

## 二、核心需求

1. 层级结构：专业（Major）→ 方向（Direction）→ 知识点（KnowledgePoint），知识点支持无限子级
2. 前置依赖：知识点可设置前置知识点（仅限同一专业内），以虚线箭头表示
3. 可视化树形图：水平展开（左→右），支持平移/缩放
4. 节点右键菜单：添加子节点、设置前置、编辑、查看题目、查看分析、删除
5. 节点显示：名称 + 描述摘要 + 标签 + 难度 + 关联题目数

---

## 三、数据模型

### 3.1 现有模型迁移策略（重要）

`backend/src/app/questions/models.py` 中已存在 `KnowledgePoint` 模型（表名 `knowledge_points`），具有 `name`、`description`、`parent_id`（自引用树）字段，并通过 `question_knowledge_points` 关联表与 `Question` 保持关系。

**采用扩展方案（Option A）**：通过 Alembic migration 对现有 `knowledge_points` 表新增字段，并新增 `major`、`direction`、`knowledge_point_prerequisite` 三张表。现有 `Question ↔ KnowledgePoint` 关联保持不变。

`KnowledgePoint` SQLAlchemy 模型迁移至 `backend/src/app/learning/models.py`，并从 `questions/models.py` 移除（保留 import 兼容性别名）。

### 3.2 数据库变更（Migration）

**新增表：**

```sql
-- 专业
CREATE TABLE major (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    deleted_at  TIMESTAMPTZ          -- 软删除
);

-- 方向
CREATE TABLE direction (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    major_id    UUID NOT NULL REFERENCES major(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    deleted_at  TIMESTAMPTZ          -- 软删除
);

-- 前置依赖关系（同一 major 内）
-- 轻量关联表，不继承 BaseModel，无 timestamps/soft-delete
CREATE TABLE knowledge_point_prerequisite (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_id UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
    to_id   UUID NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
    UNIQUE (from_id, to_id)
);
```

**修改现有 `knowledge_points` 表（ALTER）：**

```sql
ALTER TABLE knowledge_points
    ADD COLUMN direction_id UUID REFERENCES direction(id) ON DELETE SET NULL,
    ADD COLUMN tags         JSONB DEFAULT '[]',
    ADD COLUMN difficulty   VARCHAR(10) CHECK (difficulty IN ('入门','初级','中级','高级','困难'));
-- created_at / updated_at / deleted_at 已由 BaseModel/TimestampMixin/SoftDeleteMixin 提供，无需重复添加
```

`direction_id` 允许 NULL（兼容迁移前的旧数据）。

**难度字段说明：** `knowledge_points.difficulty` 使用中文字符串（`'入门'`…`'困难'`），与 `Question.difficulty`（Integer 1-5）保持独立，分别服务于不同业务语境（题目难度评分 vs 知识点学习难度）。

### 3.3 SQLAlchemy 模型

模型迁移路径：
- `KnowledgePoint`、`Major`、`Direction`、`KnowledgePointPrerequisite` → `backend/src/app/learning/models.py`
- `backend/src/app/questions/models.py` 中改为 `from app.learning.models import KnowledgePoint`（保持向后兼容）

`Major`、`Direction`、`KnowledgePoint` 继承 `BaseModel`（包含 `SoftDeleteMixin`，即 `deleted_at` 字段）。`KnowledgePointPrerequisite` 继承轻量 `Base`（仅 `id`，无 timestamps/soft-delete）。

### 3.4 Alembic Migration

文件：`backend/alembic/versions/<hash>_add_knowledge_management.py`

```python
down_revision = '3074655518ba'  # add_question_banks
```

`downgrade()` 执行顺序（注意 FK 依赖）：
1. DROP TABLE `knowledge_point_prerequisite`
2. ALTER TABLE `knowledge_points` DROP COLUMN `direction_id`, `tags`, `difficulty`
3. DROP TABLE `direction`（依赖 `major`）
4. DROP TABLE `major`

---

## 四、API 设计

所有接口前缀：`/api/knowledge`

现有 `/api/knowledge-points` 路由（`questions` 模块）保持不变，继续服务于题目管理中的知识点标签功能。新路由专注于树形管理视图。

**权限规则：** GET 接口要求已登录用户；POST/PUT/DELETE 接口要求 `ADMIN` 或 `TEACHER` 角色（与现有 questions 路由一致，使用 `require_roles(UserRole.ADMIN, UserRole.TEACHER)`）。

### 专业与方向

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/majors` | 专业列表 |
| GET | `/majors/{id}` | 专业详情 |
| POST | `/majors` | 创建专业 |
| PUT | `/majors/{id}` | 编辑专业 |
| DELETE | `/majors/{id}` | 软删除专业 |
| GET | `/majors/{id}/directions` | 某专业的方向列表 |
| GET | `/directions/{id}` | 方向详情 |
| POST | `/directions` | 创建方向 |
| PUT | `/directions/{id}` | 编辑方向 |
| DELETE | `/directions/{id}` | 软删除方向 |

### 知识点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/directions/{id}/tree` | 获取完整知识树（嵌套 JSON，含前置依赖） |
| POST | `/knowledge-points` | 创建知识点 |
| PUT | `/knowledge-points/{id}` | 编辑知识点 |
| DELETE | `/knowledge-points/{id}` | 软删除（级联子节点） |
| POST | `/knowledge-points/{id}/prerequisites` | 添加前置依赖 |
| DELETE | `/knowledge-points/{id}/prerequisites/{prereq_id}` | 移除前置依赖 |

### 树形 API 响应格式

`GET /directions/{id}/tree` 返回：

```json
{
  "nodes": [
    {
      "id": "uuid",
      "name": "排序算法",
      "description": "快速排序、归并排序...",
      "tags": ["算法"],
      "difficulty": "中级",
      "question_count": 8,
      "parent_id": "uuid-or-null",
      "depth": 1,
      "x": 0,
      "y": 0
    }
  ],
  "edges": [
    { "id": "e1", "source": "uuid-parent", "target": "uuid-child", "type": "smoothstep" },
    { "id": "e2", "source": "uuid-prereq", "target": "uuid-current", "type": "prerequisite" }
  ]
}
```

**说明：** 后端直接输出 ReactFlow 兼容的 `nodes[]` + `edges[]` 格式，前端无需转换。`type: "prerequisite"` 的 edge 对应红色虚线。坐标 `x`/`y` 由后端按层级计算（水平间距 250px，垂直间距 120px），前端可覆盖（支持拖拽）。

**��能约束：** 单个方向最多支持 300 个知识点节点。超出时 API 返回 400 并提示拆分方向。

---

## 五、前端设计

### 5.1 路由

遵循项目现有顶级路由惯例（无 `/admin` 前缀）：

```
/knowledge          → KnowledgeManagementPage
```

Refine resources 注册名：`"knowledge"`。

### 5.2 访问权限

`frontend/src/providers/access-control.ts` 中 `teacherResources` 数组添加 `"knowledge"`，使教师角色可访问。

### 5.3 组件结构

```
KnowledgeManagementPage          # 页面，管理全局状态
├── MajorDirectionSidebar        # 左侧专业/方向选择器
│   ├── MajorItem                # 可折叠专业条目
│   └── DirectionItem            # 可点击方向条目
├── KnowledgeTreeCanvas          # ReactFlow 主画布
│   ├── KnowledgeNode            # 自定义节点卡片（富文本）
│   ├── PrerequisiteEdge         # 自定义边（红色虚线 + "前置"标签）
│   └── NodeContextMenu          # Portal 右键菜单
└── NodeDetailPanel              # 右侧滑入创建/编辑面板
```

### 5.4 KnowledgeTreeCanvas 数据流

1. 选中方向后调用 `GET /api/knowledge/directions/{id}/tree`
2. 后端直接返回 `{ nodes, edges }` — 前端直接传入 `<ReactFlow nodes={nodes} edges={edges} />`
3. 节点拖拽后的位置变更仅保存在本地 state，不持久化到后端

### 5.5 节点卡片字段

| 字段 | 显示方式 |
|------|---------|
| name | 粗体标题 |
| description | 单行灰色摘要（超出截断+省略号） |
| tags | 蓝色小标签 |
| difficulty | 彩色标签（入门=黄/中级=绿/困难=红） |
| question_count | 右下角灰色"N题" |

### 5.6 右键菜单操作

1. 添加子知识点 → 打开 NodeDetailPanel（预填 parent_id）
2. 设置前置知识点 → 打开前置选择弹窗（当前方向内其他知识点，已排除自身和已有依赖）
3. 编辑 → 打开 NodeDetailPanel（填充当前数据）
4. 查看关联题目 → 跳转 `/questions?knowledge_point_id=xxx`
5. 查看学习分析 → 跳转 `/analytics?knowledge_point_id=xxx`
6. 删除 → 确认对话框（提示子节点数量）→ DELETE API

---

## 六、错误处理

| 场景 | 处理策略 |
|------|---------|
| 删除含子节点的知识点 | 确认对话框提示"将同时删除 N 个子知识点" |
| 前置依赖形成循环 | 后端返回 400；前端 toast 提示"存在循环依赖" |
| 树数据加载失败 | Canvas 显示空状态 + 重试按钮 |
| 创建/编辑保存失败 | 表单内联错误，面板保持打开 |
| 跨 Major 设置前置 | 前端选择器仅显示同 Major 节点（前端过滤） |
| 节点数超过 300 | API 返回 400；页面提示"节点数过多，请拆分方向" |

---

## 七、测试策略

### 后端（pytest）

**单元测试（`tests/unit/learning/`）：**
- 循环依赖检测算法（service 层函数）
- 跨 Major 前置约束校验

**集成测试（TestClient，`tests/integration/learning/`）：**
- Major/Direction/KnowledgePoint CRUD 全流程
- 前置依赖跨 Major 约束（期望 400）
- 循环依赖校验（期望 400）
- 软删除：已删除节点不出现在树形 API 中

### 前端

**Vitest 单元测试（`frontend/src/pages/knowledge/__tests__/`）：**
- 无（后端直接输出 ReactFlow 格式，无前端转换逻辑需测试）

**Playwright E2E（`frontend/e2e/`）：**
- 创建专业 → 方向 → 根知识点 → 子知识点全流程
- 右键菜单各操作项可触发
- 前置依赖虚线在画布上正确渲染
- 删除含子节点时确认对话框出现

---

## 八、新增依赖

| 依赖 | 用途 | 位置 |
|------|------|------|
| `@xyflow/react` | ReactFlow 知识树渲染 | 前端 |

后端无新增第三方依赖（SQLAlchemy 递归查询使用 CTE 实现）。

---

## 九、文件变更清单

**后端新建：**
- `backend/src/app/learning/models.py` — Major, Direction, KnowledgePoint（迁移自 questions/models.py）, KnowledgePointPrerequisite
- `backend/src/app/learning/schemas.py`
- `backend/src/app/learning/service.py`
- `backend/src/app/learning/router.py`
- `backend/alembic/versions/<hash>_add_knowledge_management.py` — `down_revision = '3074655518ba'`

**后端修改：**
- `backend/src/app/main.py` — 注册 `/api/knowledge` 路由
- `backend/src/app/questions/models.py` — 改为 `from app.learning.models import KnowledgePoint`（向后兼容 import）

**前端新建：**
- `frontend/src/pages/knowledge/index.tsx` — 页面入口
- `frontend/src/pages/knowledge/KnowledgeTreeCanvas.tsx`
- `frontend/src/pages/knowledge/KnowledgeNode.tsx`
- `frontend/src/pages/knowledge/PrerequisiteEdge.tsx`
- `frontend/src/pages/knowledge/NodeContextMenu.tsx`
- `frontend/src/pages/knowledge/NodeDetailPanel.tsx`
- `frontend/src/pages/knowledge/MajorDirectionSidebar.tsx`
- `frontend/src/pages/knowledge/types.ts`

**前端修改：**
- `frontend/src/App.tsx` — 添加 `/knowledge` 路由 + Refine resource `"knowledge"`
- `frontend/package.json` — 添加 `@xyflow/react`
- `frontend/src/providers/access-control.ts` — `teacherResources` 添加 `"knowledge"`
- `frontend/src/components/layout.tsx` — 将现有 `/knowledge-points` 导航项标题改为「知识点关联」（保留旧功能入口），并新增「知识点管理」链接指向 `/knowledge`
- `frontend/src/types/index.ts` — 扩展 `IKnowledgePoint` 接口，增加 `direction_id`, `tags`, `difficulty`, `question_count` 字段（或在 `pages/knowledge/types.ts` 声明扩展类型 `IKnowledgePointDetail`，与旧接口隔离）
