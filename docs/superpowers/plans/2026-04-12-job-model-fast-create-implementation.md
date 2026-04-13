# 岗位模型快速生成工具优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有岗位模型模块上补齐“标准岗位建设 + 企业快速生成 + 单列校准 + 版本控制”的第一阶段闭环。

**Architecture:** 复用现有 `job_models` 的 `JobModel + JobModelVersion + 维度/技能/知识点` 结构，只补充“标准/企业”模型语义、产业方向归属、标准来源关系和差异元数据。前端以现有 `job-models` 模块为基础，新增标准岗位库与企业快速生成入口，并将现有 `fast-create` 页面升级为企业校准入口。

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, Alembic, React, TypeScript, Vite, Refine, Vitest, Pytest

---

## File Structure

### Backend

- Modify: `backend/src/app/job_models/models.py`
  责任：为 `JobModelProject` / `JobModel` / `Skill` / `SkillKnowledgePoint` 增加标准模型、企业模型、产业方向和差异语义字段。
- Modify: `backend/src/app/job_models/schemas.py`
  责任：暴露新增字段，支持前端提交标准建设和企业校准数据。
- Modify: `backend/src/app/job_models/service.py`
  责任：新增标准岗位创建、企业模型派生、版本发布时差异元数据复制逻辑。
- Modify: `backend/src/app/job_models/router.py`
  责任：补充标准岗位列表、标准岗位推荐、企业模型派生接口。
- Create: `backend/alembic/versions/20260412_job_model_fast_create_phase1.py`
  责任：新增数据库字段和必要索引。
- Create: `backend/tests/job_models/test_fast_create_phase1.py`
  责任：覆盖标准岗位推荐、企业模型派生、版本复制差异字段。

### Frontend

- Modify: `frontend/src/pages/job-models/list.tsx`
  责任：将列表升级为“标准岗位库 + 企业模型”统一入口。
- Modify: `frontend/src/pages/job-models/fast-create.tsx`
  责任：升级为企业快速生成入口与单列校准工作台原型。
- Modify: `frontend/src/pages/job-models/upload-ai.tsx`
  责任：迁移或合并到新入口，避免重复产品路径。
- Create: `frontend/src/pages/job-models/standard-library.tsx`
  责任：标准岗位库浏览页。
- Create: `frontend/src/pages/job-models/components/model-source-badge.tsx`
  责任：统一渲染 `标准项 / 企业调整 / 企业新增` 标记。
- Create: `frontend/src/pages/job-models/components/recommend-standard-card.tsx`
  责任：渲染企业上传后推荐的标准岗位卡片。
- Create: `frontend/src/pages/job-models/components/calibration-item-card.tsx`
  责任：渲染单个能力项及其差异状态、证据、关联知识点。
- Create: `frontend/src/pages/job-models/fast-create.test.tsx`
  责任：覆盖企业快速生成页的推荐、筛选和差异展示。
- Create: `frontend/src/pages/job-models/standard-library.test.tsx`
  责任：覆盖标准岗位库筛选和入口行为。

### Docs

- Modify: `docs/superpowers/specs/2026-04-12-job-model-fast-create-design.md`
  责任：在实现时回填最终字段名和接口名。

---

### Task 1: 扩展岗位模型后端数据语义

**Files:**
- Modify: `backend/src/app/job_models/models.py`
- Modify: `backend/src/app/job_models/schemas.py`
- Create: `backend/alembic/versions/20260412_job_model_fast_create_phase1.py`
- Test: `backend/tests/job_models/test_models.py`

- [ ] **Step 1: Write the failing model/schema test**

```python
def test_job_model_supports_standard_and_enterprise_metadata():
    payload = JobModelResponse.model_validate(
        {
            "id": uuid4(),
            "current_version_id": uuid4(),
            "job_role": "Java 后端工程师",
            "version": 1,
            "version_note": None,
            "is_current": True,
            "source_type": "standard_based",
            "model_type": "enterprise",
            "status": "draft",
            "job_family": "后端开发",
            "industry_code": "ind-07",
            "industry_name": "软件和信息服务",
            "direction_code": "dir-07-03",
            "direction_name": "工业软件",
            "origin_standard_model_id": uuid4(),
            "dimensions": [],
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }
    )
    assert payload.model_type == "enterprise"
    assert payload.direction_name == "工业软件"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/job_models/test_models.py -k standard_and_enterprise_metadata -v`

Expected: FAIL with `ValidationError` or missing model fields.

- [ ] **Step 3: Write minimal implementation**

```python
class JobModel(BaseModel):
    __tablename__ = "job_models"

    model_type: Mapped[str] = mapped_column(String(20), default="standard", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    job_family: Mapped[str | None] = mapped_column(String(100), nullable=True)
    industry_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    industry_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    direction_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    direction_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    origin_standard_model_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("job_models.id", ondelete="SET NULL"), nullable=True
    )
```

```python
class JobModelResponse(BaseModel):
    model_config = {"from_attributes": True}

    model_type: str
    status: str
    job_family: str | None
    industry_code: str | None
    industry_name: str | None
    direction_code: str | None
    direction_name: str | None
    origin_standard_model_id: uuid.UUID | None
```

- [ ] **Step 4: Add and verify Alembic migration**

```python
def upgrade() -> None:
    op.add_column("job_models", sa.Column("model_type", sa.String(length=20), nullable=False, server_default="standard"))
    op.add_column("job_models", sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"))
    op.add_column("job_models", sa.Column("job_family", sa.String(length=100), nullable=True))
    op.add_column("job_models", sa.Column("industry_code", sa.String(length=50), nullable=True))
    op.add_column("job_models", sa.Column("industry_name", sa.String(length=100), nullable=True))
    op.add_column("job_models", sa.Column("direction_code", sa.String(length=50), nullable=True))
    op.add_column("job_models", sa.Column("direction_name", sa.String(length=100), nullable=True))
    op.add_column("job_models", sa.Column("origin_standard_model_id", sa.Uuid(), nullable=True))
```

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run alembic upgrade head`

Expected: migration applies successfully.

- [ ] **Step 5: Re-run tests and commit**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/job_models/test_models.py -v`

Expected: PASS

```bash
git add backend/src/app/job_models/models.py backend/src/app/job_models/schemas.py backend/alembic/versions/20260412_job_model_fast_create_phase1.py backend/tests/job_models/test_models.py
git commit -m "feat: extend job model metadata for standard and enterprise flows"
```

### Task 2: 增加标准岗位推荐与企业模型派生接口

**Files:**
- Modify: `backend/src/app/job_models/service.py`
- Modify: `backend/src/app/job_models/router.py`
- Create: `backend/tests/job_models/test_fast_create_phase1.py`
- Test: `backend/tests/job_models/test_router.py`

- [ ] **Step 1: Write the failing service and router tests**

```python
async def test_recommend_standard_model_returns_best_match(client, teacher_token, seeded_standard_models):
    response = await client.post(
        "/api/job-models/models/recommend-standard",
        headers={"Authorization": f"Bearer {teacher_token}"},
        json={"job_text": "负责 Java 后端开发，熟悉 Spring Boot、MySQL、接口设计"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["job_role"] == "Java 后端工程师"
    assert body["direction_name"] == "工业软件"
```

```python
async def test_create_enterprise_model_from_standard_copies_dimensions(client, teacher_token, seeded_standard_model):
    response = await client.post(
        f"/api/job-models/models/{seeded_standard_model.id}/create-enterprise-copy",
        headers={"Authorization": f"Bearer {teacher_token}"},
        json={"enterprise_name": "某企业后端岗位", "version_note": "初始企业版"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["model_type"] == "enterprise"
    assert body["origin_standard_model_id"] == str(seeded_standard_model.id)
    assert len(body["dimensions"]) > 0
```

- [ ] **Step 2: Run the failing tests**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/job_models/test_fast_create_phase1.py -v`

Expected: FAIL with 404 or missing functions.

- [ ] **Step 3: Implement minimal service methods**

```python
async def recommend_standard_model(db: AsyncSession, job_text: str, org_id: uuid.UUID) -> JobModel | None:
    keyword_map = {
        "java": ["Java 后端工程师"],
        "python": ["Python 开发工程师"],
        "运维": ["运维工程师"],
    }
    lowered = job_text.lower()
    role_candidates = next((roles for key, roles in keyword_map.items() if key in lowered), [])
    stmt = (
        select(JobModel)
        .join(JobModelProject)
        .where(JobModelProject.org_id == org_id, JobModel.model_type == "standard", JobModel.is_current.is_(True))
        .where(JobModel.job_role.in_(role_candidates) if role_candidates else JobModel.id.is_not(None))
        .order_by(JobModel.updated_at.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()
```

```python
async def create_enterprise_model_from_standard(
    db: AsyncSession,
    standard_model: JobModel,
    *,
    enterprise_name: str,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    version_note: str | None,
) -> tuple[JobModel, JobModelVersion]:
    enterprise_model, version = ...
    enterprise_model.model_type = "enterprise"
    enterprise_model.origin_standard_model_id = standard_model.id
    return enterprise_model, version
```

- [ ] **Step 4: Expose router endpoints**

```python
@model_router.post("/recommend-standard", response_model=JobModelSummary)
async def recommend_standard(body: RecommendStandardRequest, db: DbSession, _user: CurrentUser, org_id: CurrentOrgId):
    model = await recommend_standard_model(db, body.job_text, org_id)
    if model is None:
        raise HTTPException(status_code=404, detail="No standard model matched")
    return JobModelSummary.model_validate(model)


@model_router.post("/{model_id}/create-enterprise-copy", response_model=EnterpriseCopyResponse, status_code=201)
async def create_enterprise_copy(model_id: uuid.UUID, body: EnterpriseCopyCreate, db: DbSession, user: CurrentUser, org_id: CurrentOrgId):
    standard = await get_job_model_by_id(db, model_id)
    if standard is None or standard.model_type != "standard":
        raise HTTPException(status_code=404, detail="Standard model not found")
    created_model, version = await create_enterprise_model_from_standard(db, standard, enterprise_name=body.enterprise_name, org_id=org_id, user_id=user.id, version_note=body.version_note)
    await db.commit()
    return EnterpriseCopyResponse(job_model_id=created_model.id, version_id=version.id)
```

- [ ] **Step 5: Re-run tests and commit**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/job_models/test_fast_create_phase1.py tests/job_models/test_router.py -v`

Expected: PASS

```bash
git add backend/src/app/job_models/service.py backend/src/app/job_models/router.py backend/tests/job_models/test_fast_create_phase1.py backend/tests/job_models/test_router.py
git commit -m "feat: add standard recommendation and enterprise model derivation"
```

### Task 3: 让版本控制携带差异元数据

**Files:**
- Modify: `backend/src/app/job_models/models.py`
- Modify: `backend/src/app/job_models/service.py`
- Test: `backend/tests/job_models/test_service.py`

- [ ] **Step 1: Write the failing version-copy test**

```python
async def test_publish_new_version_preserves_item_source_and_evidence(async_session, enterprise_model_with_annotations):
    new_model = await publish_new_version(async_session, enterprise_model_with_annotations, version_note="校准后发布")
    assert new_model.version == enterprise_model_with_annotations.version + 1
    loaded = await get_job_model_by_id(async_session, new_model.id)
    assert loaded.dimensions[0].skills[0].item_source == "enterprise_added"
    assert loaded.dimensions[0].skills[0].evidence_summary == "JD 多次提及内部中台能力"
```

- [ ] **Step 2: Run the failing test**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/job_models/test_service.py -k preserves_item_source_and_evidence -v`

Expected: FAIL with missing attributes.

- [ ] **Step 3: Add minimal diff metadata fields**

```python
class Skill(BaseModel):
    __tablename__ = "skills"

    item_source: Mapped[str] = mapped_column(String(30), default="standard", nullable=False)
    change_type: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
```

```python
class SkillKnowledgePoint(BaseModel):
    __tablename__ = "skill_knowledge_points"

    item_source: Mapped[str] = mapped_column(String(30), default="standard", nullable=False)
    change_type: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    evidence_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
```

- [ ] **Step 4: Copy metadata during version publish**

```python
new_skill = Skill(
    dimension_id=new_dim.id,
    name=skill.name,
    level=skill.level,
    description=skill.description,
    sort_order=skill.sort_order,
    item_source=skill.item_source,
    change_type=skill.change_type,
    evidence_summary=skill.evidence_summary,
    source_excerpt=skill.source_excerpt,
)
```

```python
new_kp = SkillKnowledgePoint(
    skill_id=new_skill.id,
    name=kp.name,
    teaching_suggestion=kp.teaching_suggestion,
    difficulty=kp.difficulty,
    sort_order=kp.sort_order,
    item_source=kp.item_source,
    change_type=kp.change_type,
    evidence_summary=kp.evidence_summary,
    source_excerpt=kp.source_excerpt,
)
```

- [ ] **Step 5: Re-run tests and commit**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/job_models/test_service.py -v`

Expected: PASS

```bash
git add backend/src/app/job_models/models.py backend/src/app/job_models/service.py backend/tests/job_models/test_service.py
git commit -m "feat: preserve job model diff metadata across versions"
```

### Task 4: 升级前端列表为“标准岗位库 + 企业模型”双入口

**Files:**
- Modify: `frontend/src/pages/job-models/list.tsx`
- Create: `frontend/src/pages/job-models/standard-library.tsx`
- Create: `frontend/src/pages/job-models/standard-library.test.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write the failing frontend test**

```tsx
it("shows standard library and enterprise quick-create entries", async () => {
  render(<JobModelList />)
  expect(await screen.findByText("标准岗位库")).toBeInTheDocument()
  expect(screen.getByText("企业快速生成")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm vitest run src/pages/job-models/standard-library.test.tsx src/pages/job-models/list.test.ts`

Expected: FAIL with missing text or route target.

- [ ] **Step 3: Implement the list/header upgrade**

```tsx
<div className="flex gap-2">
  <Button variant="outline" onClick={() => navigate("/gwmx/job-models/standard-library")}>
    <Layers className="mr-2 h-4 w-4" />
    标准岗位库
  </Button>
  <Button onClick={() => navigate("/gwmx/job-models/fast-create")}>
    <Sparkles className="mr-2 h-4 w-4" />
    企业快速生成
  </Button>
</div>
```

```tsx
export function StandardLibraryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-base font-bold text-foreground">标准岗位库</h1>
        <p className="text-sm text-muted-foreground mt-1">按产业、方向和岗位浏览平台标准模型</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire the route**

```tsx
import { StandardLibraryPage } from "./pages/job-models/standard-library";

<Route path="/gwmx/job-models/standard-library" element={<StandardLibraryPage />} />
```

- [ ] **Step 5: Re-run tests, build, and commit**

Run: `cd frontend && pnpm vitest run src/pages/job-models/standard-library.test.tsx src/pages/job-models/list.test.ts && pnpm build`

Expected: PASS

```bash
git add frontend/src/pages/job-models/list.tsx frontend/src/pages/job-models/standard-library.tsx frontend/src/pages/job-models/standard-library.test.tsx frontend/src/App.tsx
git commit -m "feat: add standard library entry to job models"
```

### Task 5: 将 fast-create 升级为企业快速生成与单列校准入口

**Files:**
- Modify: `frontend/src/pages/job-models/fast-create.tsx`
- Create: `frontend/src/pages/job-models/components/recommend-standard-card.tsx`
- Create: `frontend/src/pages/job-models/components/calibration-item-card.tsx`
- Create: `frontend/src/pages/job-models/components/model-source-badge.tsx`
- Create: `frontend/src/pages/job-models/fast-create.test.tsx`

- [ ] **Step 1: Write the failing UI behavior test**

```tsx
it("shows recommended standard model before calibration items", async () => {
  render(<JobModelFastCreate />)
  await userEvent.type(screen.getByPlaceholderText("例如：负责后端系统开发"), "Java 后端开发，熟悉 Spring Boot")
  await userEvent.click(screen.getByRole("button", { name: "立即解析文本" }))
  expect(await screen.findByText("推荐标准岗位")).toBeInTheDocument()
  expect(screen.getByText("标准项")).toBeInTheDocument()
  expect(screen.getByText("企业新增")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && pnpm vitest run src/pages/job-models/fast-create.test.tsx`

Expected: FAIL because the current page lacks recommendation and source badges.

- [ ] **Step 3: Add reusable UI components**

```tsx
export function ModelSourceBadge({ source }: { source: "standard" | "enterprise_adjusted" | "enterprise_added" }) {
  const copy = {
    standard: "标准项",
    enterprise_adjusted: "企业调整",
    enterprise_added: "企业新增",
  }[source]

  return <Badge className="rounded-full px-2 py-0.5 text-[10px]">{copy}</Badge>
}
```

```tsx
export function RecommendStandardCard({ jobRole, industryName, directionName }: Props) {
  return (
    <div className="rounded-2xl border bg-white p-5">
      <p className="text-xs font-bold text-primary">推荐标准岗位</p>
      <h3 className="mt-2 text-base font-semibold">{jobRole}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{industryName} / {directionName}</p>
    </div>
  )
}
```

- [ ] **Step 4: Restructure fast-create into upload -> recommend -> calibrate**

```tsx
{step === "calibrate" && (
  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
    <section className="space-y-4">
      <RecommendStandardCard jobRole={recommended.job_role} industryName={recommended.industry_name} directionName={recommended.direction_name} />
      {items.map((item) => (
        <CalibrationItemCard key={item.id} item={item} />
      ))}
    </section>
    <aside className="rounded-2xl border bg-white p-5">
      <p className="text-sm font-semibold">文档命中依据</p>
    </aside>
  </div>
)}
```

- [ ] **Step 5: Re-run tests, build, and commit**

Run: `cd frontend && pnpm vitest run src/pages/job-models/fast-create.test.tsx && pnpm build`

Expected: PASS

```bash
git add frontend/src/pages/job-models/fast-create.tsx frontend/src/pages/job-models/components/recommend-standard-card.tsx frontend/src/pages/job-models/components/calibration-item-card.tsx frontend/src/pages/job-models/components/model-source-badge.tsx frontend/src/pages/job-models/fast-create.test.tsx
git commit -m "feat: turn fast create into enterprise calibration flow"
```

### Task 6: 接通前后端推荐与创建流程

**Files:**
- Modify: `frontend/src/pages/job-models/fast-create.tsx`
- Modify: `frontend/src/pages/job-models/upload-ai.tsx`
- Test: `frontend/src/pages/job-models/fast-create.test.tsx`
- Test: `backend/tests/job_models/test_fast_create_phase1.py`

- [ ] **Step 1: Write the failing integration-style UI test**

```tsx
it("calls recommend endpoint and creates enterprise model from standard", async () => {
  server.use(
    http.post("/api/job-models/models/recommend-standard", () => HttpResponse.json({ id: "std-1", job_role: "Java 后端工程师", industry_name: "软件和信息服务", direction_name: "工业软件" })),
    http.post("/api/job-models/models/std-1/create-enterprise-copy", () => HttpResponse.json({ job_model_id: "ent-1", version_id: "ver-1" }))
  )
  render(<JobModelFastCreate />)
  await userEvent.type(screen.getByPlaceholderText("例如：负责后端系统开发"), "Java 后端开发")
  await userEvent.click(screen.getByRole("button", { name: "立即解析文本" }))
  await userEvent.click(await screen.findByRole("button", { name: "使用该标准岗位继续" }))
  expect(mockNavigate).toHaveBeenCalledWith("/gwmx/job-models/ent-1/versions/ver-1/editor")
})
```

- [ ] **Step 2: Run the failing test**

Run: `cd frontend && pnpm vitest run src/pages/job-models/fast-create.test.tsx -t "calls recommend endpoint"`

Expected: FAIL with missing network calls or incorrect navigation.

- [ ] **Step 3: Add minimal API orchestration**

```tsx
const recommendStandard = async () => {
  const res = await fetch("/api/job-models/models/recommend-standard", {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({ job_text: jdText }),
  })
  return await res.json()
}

const createEnterpriseCopy = async (standardId: string) => {
  const res = await fetch(`/api/job-models/models/${standardId}/create-enterprise-copy`, {
    method: "POST",
    headers: authJsonHeaders(),
    body: JSON.stringify({
      enterprise_name: `${recommended.job_role}-企业版`,
      version_note: "AI 初始生成",
    }),
  })
  return await res.json()
}
```

- [ ] **Step 4: Remove duplicated legacy upload flow**

```tsx
<Button onClick={() => navigate("/gwmx/job-models/fast-create")}>
  <Sparkles className="mr-2 h-4 w-4" />
  企业快速生成
</Button>
```

并将 `upload-ai.tsx` 保留为跳转页，避免双入口逻辑分叉。

- [ ] **Step 5: Re-run tests, build, and commit**

Run: `cd frontend && pnpm vitest run src/pages/job-models/fast-create.test.tsx && pnpm build`

Expected: PASS

```bash
git add frontend/src/pages/job-models/fast-create.tsx frontend/src/pages/job-models/upload-ai.tsx frontend/src/pages/job-models/fast-create.test.tsx
git commit -m "feat: connect enterprise fast create flow to backend"
```

### Task 7: 完善标准岗位建设入口与回归验证

**Files:**
- Modify: `frontend/src/pages/job-models/create.tsx`
- Modify: `backend/src/app/job_models/router.py`
- Modify: `backend/tests/job_models/test_router.py`
- Modify: `frontend/src/pages/job-models/list.test.ts`
- Modify: `docs/superpowers/specs/2026-04-12-job-model-fast-create-design.md`

- [ ] **Step 1: Write the failing create-flow tests**

```python
async def test_create_page_can_create_standard_project(client, teacher_token):
    response = await client.post(
        "/api/job-models/projects",
        headers={"Authorization": f"Bearer {teacher_token}"},
        json={"name": "工业软件-Java后端", "industry": "软件和信息服务", "project_type": "standard_build"},
    )
    assert response.status_code == 201
    assert response.json()["status"] == "draft"
```

```tsx
it("allows creating a standard model project from create page", async () => {
  render(<JobModelCreate />)
  expect(screen.getByText("创建标准岗位模型")).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the failing tests**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/job_models/test_router.py -k standard_project -v`

Run: `cd frontend && pnpm vitest run src/pages/job-models/list.test.ts`

Expected: FAIL with missing `project_type` support or missing UI copy.

- [ ] **Step 3: Implement minimal standard-build mode**

```tsx
const [projectType, setProjectType] = useState<"standard_build" | "enterprise_calibration">("standard_build")

await fetch("/api/job-models/models", {
  method: "POST",
  headers: authJsonHeaders(),
  body: JSON.stringify({
    name: projectName,
    industry,
    project_type: projectType,
    description,
  }),
})
```

```python
class ProjectCreate(BaseModel):
    name: str = Field(max_length=200)
    industry: str | None = Field(default=None, max_length=100)
    description: str | None = None
    project_type: Literal["standard_build", "enterprise_calibration"] = "standard_build"
```

- [ ] **Step 4: Run full targeted verification**

Run: `cd backend && UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/job_models -v`

Run: `cd frontend && pnpm vitest run src/pages/job-models && pnpm build`

Expected: PASS

- [ ] **Step 5: Update spec and commit**

```markdown
- 已落实字段：`project_type`, `model_type`, `origin_standard_model_id`
- 已落实接口：`POST /api/job-models/models/recommend-standard`
- 已落实入口：标准岗位库、企业快速生成
```

```bash
git add frontend/src/pages/job-models/create.tsx backend/src/app/job_models/router.py backend/tests/job_models/test_router.py frontend/src/pages/job-models/list.test.ts docs/superpowers/specs/2026-04-12-job-model-fast-create-design.md
git commit -m "feat: add standard build mode and finalize phase1 verification"
```

---

## Self-Review

### Spec coverage

本计划已覆盖：

1. 标准岗位建设入口
2. 企业快速生成入口
3. 标准岗位推荐
4. 单列校准视图的差异语义
5. 在线模型输出
6. 版本控制
7. 基于现有岗位模型结构的增强实现

未纳入第一阶段的内容已明确排除：

1. 企业版本反向沉淀平台标准
2. 全量产业岗位覆盖
3. 复杂报告输出

### Placeholder scan

已检查计划中无 `TODO`、`TBD`、`implement later` 等占位符。

### Type consistency

统一采用以下字段名：

1. `project_type`
2. `model_type`
3. `origin_standard_model_id`
4. `item_source`
5. `change_type`
6. `evidence_summary`
7. `source_excerpt`
