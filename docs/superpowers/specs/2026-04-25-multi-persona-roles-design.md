# 多人员适配设计：业务角色抽象与企业招聘考试支持

**日期**：2026-04-25
**作者**：架构组
**状态**：待评审
**关联模块**：`rbac`、`auth`、`exams`、`questions`、前端 `pages/exams`、`pages/student`

---

## 1. 背景与目标

### 1.1 现状

平台现有两个子系统：

- **岗位模型 - 工教桥**：服务企业（`enterprise_admin`、`enterprise_user`）和学校（`school_admin`），用于岗位能力建模、岗位-课程缺口分析。
- **智评云**：服务学校（`teacher`、`student`），用于题库、考试、AI 评分、错题本、学生分析。

实际业务中，**智评云的核心流程**（出题 → 组卷 → 发考试 → 评分 → 看结果）对其他人员同样适用，例如：

- 企业 HR 做招聘笔试 / 内部晋升考核
- 政府能力测评中心、第三方认证机构、咨询公司培训

但当前实现存在三个限制：

1. **角色硬编码**：`exams/router.py` 等模块大量出现 `user_has_role(db, uid, "teacher", "student", "school_admin")` 等硬编码检查，扩展角色需要散点改动。
2. **企业 admin 权限不足**：`enterprise_admin` 当前只有 `job_model` 相关权限，无法发布考试。
3. **缺少外部考生入口**：候选人在系统里没有账号，无法直接邀请参加考试。

### 1.2 目标（本期范围）

- 抽象业务角色 `evaluator`（评测者）和 `assessee`（参加测评人员），覆盖所有"出题/参加考试"场景。
- 保留 `platform_admin` / `school_admin` / `enterprise_admin` 不变，扩展 `enterprise_admin` 的考试相关权限。
- 支持**一人多角色**（同一机构内同时持有多个角色）。
- 支持**外部候选人**通过"邀请链接 + 一次性令牌"参加企业招聘考试。
- 学校侧 teacher/student 体验**零回归**。

### 1.3 非目标

- `reviewer`（评审人）角色：暂缓，未来招聘场景成熟后再加。
- 新增 OrgType（政府测评 / 认证机构 / 咨询公司）：暂保持 `school` / `enterprise` 两类。
- 合并 `Position` 与 `JobModel`：本期不做。
- 企业内部岗位模型驱动的题库自动生成：本期不做。

---

## 2. 角色与权限模型

### 2.1 角色清单

| 角色 | 类型 | 说明 |
|---|---|---|
| `platform_admin` | 系统级 | 不变 |
| `school_admin` | 机构级 | 不变 |
| `enterprise_admin` | 机构级 | **权限扩展**：增加 `exam:*` / `question:*` / `knowledge:read` 等业务权限 |
| `enterprise_user` | 机构级 | 不变（岗位模型场景普通员工） |
| `evaluator` | 业务级（**新**） | 出题、组卷、发考试、阅卷、看结果。`teacher` 是其在学校场景的别名 |
| `assessee` | 业务级（**新**） | 参加考试、查自己成绩、错题本。`student` 是其在学校场景的别名 |
| `teacher` | 业务级（保留为别名） | seed 时与 `evaluator` 权限完全一致 |
| `student` | 业务级（保留为别名） | seed 时与 `assessee` 权限完全一致 |

### 2.2 后端代码风格

- 所有角色检查从硬编码角色名迁移到**能力检查**（`user_has_capability(user, "exam.create")`）或**带别名的角色检查**（`user_has_role(user, "evaluator", "teacher")`）。
- `evaluator` 与 `teacher`、`assessee` 与 `student` 在权限层完全等价，业务代码不区分。
- 兼容期：旧角色名继续被识别，新代码统一用业务级名称。

### 2.3 enterprise_admin 权限补齐

seed 时为 `enterprise_admin` 追加：

```
exam:create / exam:read / exam:update / exam:delete
question:create / question:read / question:update / question:delete
knowledge:read
```

未来可由企业管理员将 `evaluator` 单独授予某些 HR / 面试官（不必给 admin 权限）。

### 2.4 一人多角色：UserOrganization 重构

当前主键 `(user_id, org_id)` → 改为 `(user_id, org_id, role_id)`，新增 `is_primary_role` 字段（用于 UI 默认入口判断，同一 (user, org) 下唯一为 true）。

典型组合示例：

| 用户类型 | 持有角色 |
|---|---|
| 学校教师 | `teacher` |
| 学校副校长 | `teacher` + `school_admin` |
| 企业 HR | `evaluator` |
| 企业 HR 主管 | `evaluator` + `enterprise_admin` |
| 内部员工 | `enterprise_user` + `assessee` |
| 外部候选人 | `assessee` |

---

## 3. 数据模型改动

### 3.1 User 表扩展

新增字段：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `user_type` | VARCHAR(20) NOT NULL | `'internal'` | `internal` / `external_guest` |
| `primary_org_id` | UUID NULL | — | external_guest 必填，指向其所属企业 org |

约束：

- `external_guest` 用户不能通过用户名/密码登录：登录接口在校验 `password_hash` 之前先拒绝 `user_type='external_guest'`，仅凭 invitation token 进入考试。`is_active` 字段语义保持原样（用于停用账号），不复用为外部访客标记。
- 同一企业 org 下，对 `external_guest` 类型的用户，`(phone, primary_org_id)` 唯一（同一候选人多次招聘可复用账号）。
- 现有索引 `ix_users_username_active`、`ix_users_email_active` 保持不变。

### 3.2 UserOrganization 多角色

```python
class UserOrganization(Base, TimestampMixin):
    __tablename__ = "user_organizations"
    user_id: PrimaryKey, FK->users (CASCADE)
    org_id: PrimaryKey, FK->organizations (CASCADE)
    role_id: PrimaryKey, FK->roles (RESTRICT)   # 新进主键
    is_primary_role: BOOLEAN NOT NULL DEFAULT TRUE
```

应用层在新增/修改角色时保证：同一 `(user, org)` 下最多一个 `is_primary_role=true`。

### 3.3 ExamInvitation 新表

```python
class ExamInvitation(BaseModel):
    __tablename__ = "exam_invitations"

    exam_id: FK->exams (CASCADE), NOT NULL
    user_id: FK->users (CASCADE), NOT NULL  # external_guest user
    token_hash: VARCHAR(128) NOT NULL        # SHA-256(token), token 原文不存
    expires_at: TIMESTAMPTZ NOT NULL
    used_at: TIMESTAMPTZ NULL                # 首次成功换 session 后写入
    revoked_at: TIMESTAMPTZ NULL             # HR 手动作废
    created_by: FK->users, NOT NULL          # 邀请发起人

    UniqueConstraint(exam_id, user_id) -- 同候选人同考试唯一邀请
    Index(token_hash)
```

**Token 生成与流转**：

1. `secrets.token_urlsafe(32)` → 43 字符 base64url 字符串
2. 数据库存 `SHA-256(token)`，原文只在响应里返回一次（嵌入邀请链接）
3. 候选人访问 `/exam-invite?token=xxx` → 后端 hash 反查 → 验证未过期/未撤销 → 签发短期 JWT（claims: `user_id`、`exam_id`、`scope=exam_take`，exp=`exam.end_time + 30min`）
4. 同一 token 在有效期内多次访问允许（`used_at` 仅记录首次）

### 3.4 Position vs JobModel

本期不合并。`Exam.position_id` 继续指向 `Position`（轻量岗位标签），`JobModel`（企业完整能力模型）保持独立。

### 3.5 Alembic 迁移

文件：`backend/alembic/versions/<rev>_recruitment_personas.py`

按依赖顺序：

1. `users`：`ADD COLUMN user_type`、`ADD COLUMN primary_org_id`、新增条件唯一索引 `ix_users_phone_org_external`
2. `user_organizations`：删除现有主键 `(user_id, org_id)` → 新主键 `(user_id, org_id, role_id)`；`ADD COLUMN is_primary_role DEFAULT true`
3. 创建 `exam_invitations` 表（含索引 / 唯一约束）

`app/rbac/seed.py` 内的 seed 函数本身已是幂等 upsert，会在应用启动时自动补齐 `evaluator` / `assessee` 角色和 `enterprise_admin` 新增权限。

**回滚**：每步均有 down migration；`user_organizations` 回退时把多角色用户压缩为 `is_primary_role=true` 那一行（迁移前需确认无人多角色，否则极端场景下损失数据）。

---

## 4. 后端服务与 API

### 4.1 能力检查工具

`app/auth/dependencies.py` 新增：

```python
async def user_has_capability(
    db: AsyncSession, user_id: UUID, *capabilities: str
) -> bool:
    """capability 格式 'exam.create'，遍历用户所有角色累加权限。"""

def require_capability(*capabilities: str):
    """FastAPI dependency: 当前用户必须持有任一指定能力，否则 403。"""
```

### 4.2 角色检查改造点

| 文件 | 现状 | 改造 |
|---|---|---|
| [backend/src/app/exams/router.py:75](backend/src/app/exams/router.py:75) | `_is_exam_admin` / `_is_student_user` 硬编码 | 改用 `user_has_capability("exam.create")` 或 `user_has_role("evaluator","teacher")` |
| [backend/src/app/exams/positions_router.py:50](backend/src/app/exams/positions_router.py:50) | 系统岗位创建仅 platform_admin/school_admin | 加上 `enterprise_admin` |
| `backend/src/app/questions/`、`backend/src/app/knowledge/`、`backend/src/app/grading/` | 散点角色判断 | 同样替换 |

### 4.3 邀请考试 API

```
POST   /api/exams/{exam_id}/invitations/bulk
       Body: [{full_name, phone, email}, ...]
       Resp: [{user_id, invitation_id, invite_url}]

GET    /api/exams/{exam_id}/invitations
DELETE /api/exams/{exam_id}/invitations/{id}                # 作废
POST   /api/exams/{exam_id}/invitations/{id}/resend         # 重发链接

POST   /api/exam-invite/redeem
       Body: {token}
       Resp: {access_token, exam_id, candidate_info}
```

权限：前 4 个接口要求调用者持有 `exam.create` 能力且是该 exam 的 owner 或同 enterprise org 的 `enterprise_admin`。

### 4.4 邀请服务

`app/exams/invitation_service.py`（新增）：

- `create_invitation(exam, candidate_info, evaluator)`：
  1. 解析归属企业 org：取 `evaluator` 在 `user_organizations` 中 `is_primary_role=true` 且 `organization.type='enterprise'` 的 org（无则报错：仅企业机构的 evaluator 可发起外部邀请）
  2. 在该 enterprise org 下，按 `(phone, primary_org_id)` 查或建 `external_guest` user
  3. 给该 user 加 `assessee` 角色（`UserOrganization` 写入）
  4. 写入 `exam_students` 记录
  5. 生成 token + 写 `exam_invitations`
  6. 返回邀请 URL
- `redeem_token(token)`：hash 反查 → 校验未过期/未撤销 → 签发短期 JWT
- `revoke_invitation(invitation_id)`：写 `revoked_at`

### 4.5 候选人访问中间件

`require_internal_or_invitation`：

- 内部用户（`user_type=internal`）：走原有 JWT 校验
- external_guest：JWT 必须含 `scope=exam_take` 且 `exam_id` 与请求路径匹配，否则 403
- 防止候选人调 `/api/users`、`/api/exams`（管理接口）等

### 4.6 邀请通知

接入现有 `app/notifications`：

- 邀请创建后异步触发邮件 + 短信（如配置）
- 邮件模板：考试名、时间、链接、考试时长、注意事项
- 失败重试 3 次

### 4.7 数据可见性

- `evaluator`：看自己创建的 exam（`Exam.owner_id == user.id`，沿用 `OwnerMixin`）
- `enterprise_admin`：看本机构所有 exam —— 取 `Exam.owner_id` 对应 user 的 `user_organizations`，与当前 admin 共享同一 enterprise org_id 即可见
- `assessee`：看自己被加入的 exam（`exam_students.student_id == user.id`，已有逻辑）

---

## 5. 前端改动

### 5.1 文案别名层

新建 `frontend/src/lib/role-display.ts`：

```typescript
type OrgKind = "school" | "enterprise"

const ROLE_DISPLAY: Record<OrgKind, Record<"evaluator" | "assessee", string>> = {
  school:     { evaluator: "教师",   assessee: "学生" },
  enterprise: { evaluator: "HR",     assessee: "候选人" },
}

export function displayRole(orgKind: OrgKind, role: "evaluator" | "assessee"): string
export function displayAssesseeNoun(orgKind: OrgKind): string
```

后端 API 统一返回 `evaluator` / `assessee`；前端按当前用户所在 org 的 `type` 决定文案。

### 5.2 考生导入面板：双 Tab

考试创建/编辑页 [frontend/src/pages/exams/](frontend/src/pages/exams/) 的"添加考生"组件改造：

| Tab | 适用 OrgType | 说明 |
|---|---|---|
| **从系统选择 / 班级导入** | school + enterprise(internal) | 沿用现有 UI |
| **导入外部候选人** | enterprise 独有 | 新增 |

学校机构看不到第二个 Tab；企业机构两个都显示。

外部候选人导入 UI：

- Excel 上传（列：姓名、手机、邮箱）/ 手工逐行添加
- 上传后预览表格（有效行 / 重复行 / 缺字段行高亮）
- 确认后调 `POST /invitations/bulk` → 拿到 `invite_url` 列表
- 显示"已发送邀请 N 条"，给"复制全部链接"按钮

### 5.3 邀请管理页

考试详情新增"邀请记录" Tab：

- 表格列：候选人姓名、手机、邀请状态（已发送 / 已访问 / 已交卷 / 已作废）、操作（重发 / 作废 / 复制链接）
- 仅 enterprise org 的考试显示该 Tab

### 5.4 候选人答题入口

新增独立路由 `frontend/src/pages/exam-invite/`：

- `landing.tsx` 接 `/exam-invite?token=xxx`：
  - 调 `POST /api/exam-invite/redeem` → 短期 JWT 存内存（不入 localStorage）
  - 显示考试基本信息 + 注意事项 + "开始考试"按钮
- 进考试后复用现有 `student/exam-taking` 组件
- 交卷后落地页：显示"已交卷"+ 简单致谢；不显示成绩
- **隐藏所有导航**：`AppShell` 检测到 `external_guest` 时渲染纯净布局

### 5.5 企业工作台微调

[frontend/src/pages/gwmx/workbench.tsx](frontend/src/pages/gwmx/workbench.tsx) 加"招聘考试"快速入口卡片：

- 仅当用户在某 enterprise org 下持 `evaluator` 或 `enterprise_admin` 时显示
- 跳转 `pages/exams/` 列表

### 5.6 路由守卫

新增 `<RequireCapability capability="exam.create">` 组件，从用户当前 org 的角色集合解析能力。external_guest 只能访问 `/exam-invite/*`，其他全部重定向。

---

## 6. 测试策略

### 6.1 后端单元测试

| 文件 | 覆盖点 |
|---|---|
| `tests/auth/test_capabilities.py` | `user_has_capability` 跨多角色累加；teacher/evaluator 别名等价；external_guest 受限 |
| `tests/rbac/test_user_org_multi_role.py` | 一人多角色增删；`is_primary_role` 唯一性；旧数据迁移后行为等价 |
| `tests/rbac/test_seed_idempotent.py` | seed 重复执行不产生重复数据；evaluator/assessee 与 teacher/student 权限一致 |
| `tests/exams/test_invitation_service.py` | 创建邀请去重；token 生成与 hash；redeem 验签；过期/作废拒绝；防跨考试 |
| `tests/exams/test_invitation_router.py` | API 集成：bulk 导入 / 列表 / 撤销 / 重发；权限正确 |
| `tests/exams/test_external_guest_access.py` | external_guest JWT 只能访问对应 exam 的答题接口；管理接口返回 403 |
| `tests/exams/test_router_role_check.py` | 现有 `_is_exam_admin` / `_is_student_user` 改造后行为不变（回归） |

夹具：在 `tests/conftest.py` 增加 `evaluator_user_factory` / `assessee_user_factory` / `external_guest_factory`。

### 6.2 后端集成测试

`tests/integration/test_recruitment_flow.py`：

1. enterprise_admin 创建招聘考试（含题目）
2. bulk 导入 3 个候选人 → 拿到 invite_url
3. 用 token 调 redeem → 短期 JWT
4. 用 JWT 提交答案、交卷
5. enterprise_admin 查看结果，邀请记录状态正确流转

### 6.3 前端测试

- **vitest**：`role-display.ts` 在 school/enterprise 下文案正确；`<RequireCapability>` 守卫逻辑
- **playwright**：
  - `e2e/recruitment-flow.spec.ts`：HR 全流程（建考试 → 导入候选人 → 复制链接）
  - `e2e/candidate-flow.spec.ts`：模拟点链接 → 进考试 → 交卷 → 落地页
  - `e2e/regression-school.spec.ts`：教师 + 学生现有流程不破

### 6.4 手工回归清单

PR-1+2 部署后必跑：

- [ ] teacher 登录 → 创建/编辑/发布考试，与改造前等价
- [ ] student 登录 → 进入考试列表 / 答题 / 错题本，与改造前等价
- [ ] school_admin 登录 → 班级管理、用户管理、岗位模型，无功能丢失
- [ ] enterprise_admin（旧）登录 → 岗位模型功能完整 + 新增 exam/question 入口可见
- [ ] e2e 现有用例全绿

### 6.5 安全测试要点

- Token 不可枚举（`secrets.token_urlsafe(32)`，hash 长度 ≥ 64）
- 候选人不能用 invitation JWT 访问其他 exam（中间件检查）
- 候选人不能调管理接口（`require_capability` 拦截）
- 邀请链接 `<meta name="robots" content="noindex">`

---

## 7. 上线策略

### 7.1 PR 拆分

| PR | 内容 | 风险 |
|---|---|---|
| PR-1 | UserOrganization 多角色 + seed 加 evaluator/assessee + enterprise_admin 权限补齐 | 中（影响所有现网用户） |
| PR-2 | `user_has_capability` + 替换 exam/question/knowledge 模块的硬编码角色检查 | 中（行为应保持等价） |
| PR-3 | User.user_type/primary_org_id + ExamInvitation 表 + invitation 服务和 API | 低（新增功能） |
| PR-4 | 前端文案别名层 + 考试创建页"外部候选人"Tab + 邀请管理页 | 低 |
| PR-5 | 候选人独立答题入口路由 + 中间件守卫 | 低（新增） |

PR-1 + PR-2 一起 merge & deploy，验证学校侧零回归后再上 PR-3~5。

### 7.2 灰度开关

- 后端：`app/config.py` 加 `ENABLE_EXTERNAL_INVITATION` 环境变量（默认 true，应急可关）
- 前端：通过 `/api/auth/me` 返回的 `available_features` 字段控制"招聘考试"入口可见

### 7.3 风险与缓解

| 风险 | 缓解 |
|---|---|
| RBAC 主键变更影响并发写入 | 迁移在维护窗口执行；先在 staging 用真实数据回放 |
| 角色检查改造引入回归 | §6.4 手工回归清单 + 全量 e2e 跑过才上线 |
| 外部候选人邀请被滥用 | Token 有效期严格绑 exam.end_time；限制每 exam 邀请数；HR 可一键全部作废 |

---

## 8. 验收标准

### 8.1 学校侧（零回归）

- 现有 teacher / student 全部用例继续通过
- 现有 school_admin 流程无变化

### 8.2 企业侧（新能力）

- enterprise_admin 可创建/发布招聘考试
- HR 可批量导入外部候选人，拿到邀请链接
- 候选人凭链接进入考试，答题、交卷
- HR 可查看邀请状态、考试成绩、批阅主观题
- 候选人交卷后无法访问任何管理接口

### 8.3 安全

- §6.5 全部安全测试用例通过

---

## 9. 后续演进（不在本期）

1. `reviewer` 角色：招聘场景成熟后引入"只评分不出题"角色
2. OrgType 扩展：政府测评 / 认证机构 / 咨询公司
3. JobModel ↔ Position 整合：从企业岗位模型一键生成考试岗位标签
4. 候选人多次招聘账号合并 / 自动归档策略
