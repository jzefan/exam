# 岗位模型去项目化重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将岗位模型模块从 `Project -> JobModel` 结构重构为 `JobModel -> JobModelVersion`，并同步替换后端接口、前端路由、编辑器跳转、删除逻辑与 seed 数据。

**Architecture:** 以 `JobModel` 作为岗位模型主实体，以 `JobModelVersion` 作为内容版本实体，维度/技能/知识点全部下挂到版本。后端先完成新数据模型与接口，再切前端路由和页面逻辑，最后用新的标准岗位 seed 恢复演示数据并完成删除闭环。

**Tech Stack:** FastAPI, SQLAlchemy async ORM, Alembic, React, React Router, Vitest, pnpm, PostgreSQL

---

## File Map

### Backend core

- Modify: `backend/src/app/job_models/models.py`
- Modify: `backend/src/app/job_models/schemas.py`
- Modify: `backend/src/app/job_models/service.py`
- Modify: `backend/src/app/job_models/router.py`
- Create: `backend/alembic/versions/20260413_job_model_deproject.py`

### Backend tests

- Modify: `backend/tests/job_models/test_models.py`
- Modify: `backend/tests/job_models/test_service.py`
- Modify: `backend/tests/job_models/test_router.py`
- Modify: `backend/tests/job_models/test_fast_create_phase1.py`

### Frontend pages

- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/job-models/list.tsx`
- Modify: `frontend/src/pages/job-models/standard-library.tsx`
- Modify: `frontend/src/pages/job-models/fast-create.tsx`
- Modify: `frontend/src/pages/job-models/create.tsx`
- Modify: `frontend/src/pages/job-models/editor/index.tsx`
- Modify: `frontend/src/pages/job-models/editor/content-panel.tsx`
- Modify: `frontend/src/pages/job-models/editor/properties-panel.tsx`

### Frontend tests

- Modify: `frontend/src/pages/job-models/list.test.ts`
- Modify: `frontend/src/pages/job-models/standard-library.test.tsx`
- Modify: `frontend/src/pages/job-models/fast-create.test.tsx`
- Modify: `frontend/src/pages/job-models/editor/properties-panel.test.tsx`

### Seed and docs

- Modify: `backend/scripts/seed_standard_job_models.py`
- Modify: `docs/superpowers/specs/2026-04-12-job-model-fast-create-design.md`
- Modify: `docs/superpowers/plans/2026-04-12-job-model-fast-create-implementation.md`

---

### Task 1: 重建领域模型与 Alembic 迁移

**Files:**
- Modify: `backend/src/app/job_models/models.py`
- Create: `backend/alembic/versions/20260413_job_model_deproject.py`
- Test: `backend/tests/job_models/test_models.py`

- [ ] **Step 1: 先写 ORM 结构失败测试**

```python
def test_job_model_version_relationship_shape():
    from app.job_models.models import JobModel, JobModelVersion, CompetencyDimension

    assert hasattr(JobModel, "current_version_id")
    assert hasattr(JobModel, "versions")
    assert hasattr(JobModelVersion, "job_model_id")
    assert CompetencyDimension.model_version_id.property.columns[0].name == "model_version_id"
```

- [ ] **Step 2: 运行模型测试确认先失败**

Run: `cd backend && PYTHONPATH=src uv run python -m pytest tests/job_models/test_models.py -k version_relationship_shape -v`

Expected: FAIL，提示 `JobModelVersion` 不存在或 `current_version_id` / `model_version_id` 缺失

- [ ] **Step 3: 实现最小模型重构**

```python
class JobModel(BaseModel):
    __tablename__ = "job_models"

    job_role: Mapped[str] = mapped_column(String(200), nullable=False)
    model_type: Mapped[str] = mapped_column(String(20), default="standard", nullable=False)
    job_family: Mapped[str | None] = mapped_column(String(100), nullable=True)
    industry_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    industry_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    direction_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    direction_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    org_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    origin_standard_model_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("job_models.id", ondelete="SET NULL"), nullable=True)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("job_model_versions.id", ondelete="SET NULL"), nullable=True)

    versions: Mapped[list["JobModelVersion"]] = relationship(
        "JobModelVersion",
        back_populates="job_model",
        cascade="all, delete-orphan",
        foreign_keys="JobModelVersion.job_model_id",
        order_by="JobModelVersion.version.desc()",
    )


class JobModelVersion(BaseModel):
    __tablename__ = "job_model_versions"

    job_model_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("job_models.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    version_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    raw_content: Mapped[dict | None] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    job_model: Mapped["JobModel"] = relationship("JobModel", back_populates="versions", foreign_keys=[job_model_id])
    dimensions: Mapped[list["CompetencyDimension"]] = relationship(
        "CompetencyDimension",
        back_populates="model_version",
        cascade="all, delete-orphan",
        order_by="CompetencyDimension.sort_order",
    )


class CompetencyDimension(BaseModel):
    model_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("job_model_versions.id", ondelete="CASCADE"), nullable=False
    )
```

- [ ] **Step 4: 写 Alembic 迁移**

```python
def upgrade() -> None:
    op.drop_table("source_documents")
    op.drop_table("job_model_projects")
    op.create_table(
        "job_model_versions",
        sa.Column("job_model_id", sa.UUID(), sa.ForeignKey("job_models.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("version_note", sa.Text(), nullable=True),
        sa.Column("source_type", sa.String(length=20), nullable=False, server_default="manual"),
        sa.Column("raw_content", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_current", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column("job_models", sa.Column("org_id", sa.UUID(), nullable=True))
    op.add_column("job_models", sa.Column("created_by", sa.UUID(), nullable=True))
    op.add_column("job_models", sa.Column("current_version_id", sa.UUID(), nullable=True))
    op.drop_column("job_models", "project_id")
    op.add_column("competency_dimensions", sa.Column("model_version_id", sa.UUID(), nullable=True))
    op.drop_constraint("competency_dimensions_model_id_fkey", "competency_dimensions", type_="foreignkey")
    op.drop_column("competency_dimensions", "model_id")
```

- [ ] **Step 5: 运行模型测试确认通过**

Run: `cd backend && PYTHONPATH=src uv run python -m pytest tests/job_models/test_models.py -k "version_relationship_shape or job_model" -v`

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/src/app/job_models/models.py backend/alembic/versions/20260413_job_model_deproject.py backend/tests/job_models/test_models.py
git commit -m "refactor: rebuild job model domain without projects"
```

---

### Task 2: 后端创建、查询、删除接口切换到 JobModel + Version

**Files:**
- Modify: `backend/src/app/job_models/schemas.py`
- Modify: `backend/src/app/job_models/service.py`
- Modify: `backend/src/app/job_models/router.py`
- Test: `backend/tests/job_models/test_service.py`
- Test: `backend/tests/job_models/test_router.py`

- [ ] **Step 1: 先写接口失败测试**

```python
async def test_create_job_model_creates_initial_version(client, auth_headers):
    response = await client.post(
        "/api/job-models/models",
        json={
            "job_role": "Java 后端工程师",
            "model_type": "standard",
            "status": "draft",
            "industry_name": "软件和信息服务",
            "direction_name": "工业软件",
            "dimensions": [],
        },
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert data["id"]
    assert data["current_version_id"]
    assert data["current_version"]["version"] == 1
```

- [ ] **Step 2: 跑路由测试确认失败**

Run: `cd backend && PYTHONPATH=src uv run python -m pytest tests/job_models/test_router.py -k create_job_model_creates_initial_version -v`

Expected: FAIL，返回结构仍依赖 `project_id` 或无法创建 `current_version`

- [ ] **Step 3: 重写 schema**

```python
class JobModelVersionSummary(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_model_id: uuid.UUID
    version: int
    version_note: str | None
    source_type: str
    is_current: bool
    created_at: datetime
    updated_at: datetime


class JobModelResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    job_role: str
    model_type: str
    status: str
    job_family: str | None
    industry_name: str | None
    direction_name: str | None
    origin_standard_model_id: uuid.UUID | None
    current_version_id: uuid.UUID | None
    current_version: JobModelVersionSummary | None
    created_at: datetime
    updated_at: datetime
```

- [ ] **Step 4: 重写 service 创建与删除逻辑**

```python
async def create_job_model(db: AsyncSession, data: JobModelCreate, *, org_id: uuid.UUID, user_id: uuid.UUID) -> JobModel:
    model = JobModel(
        job_role=data.job_role,
        model_type=data.model_type,
        status=data.status,
        job_family=data.job_family,
        industry_name=data.industry_name,
        direction_name=data.direction_name,
        org_id=org_id,
        created_by=user_id,
        origin_standard_model_id=data.origin_standard_model_id,
    )
    db.add(model)
    await db.flush()

    version = JobModelVersion(
        job_model_id=model.id,
        version=1,
        version_note=data.version_note,
        source_type=data.source_type,
        is_current=True,
    )
    db.add(version)
    await db.flush()

    model.current_version_id = version.id
    for dim_data in data.dimensions:
        await _create_dimension(db, version.id, dim_data)

    await db.flush()
    return model


async def delete_job_model(db: AsyncSession, model: JobModel) -> None:
    model.deleted_at = datetime.now(timezone.utc)
    for version in model.versions:
        version.deleted_at = datetime.now(timezone.utc)
```

- [ ] **Step 5: 重写 router**

```python
@model_router.post("", response_model=JobModelResponse, status_code=status.HTTP_201_CREATED)
async def create_model(body: JobModelCreate, db: DbSession, user: CurrentUser, org_id: CurrentOrgId) -> JobModelResponse:
    model = await create_job_model(db, body, org_id=org_id, user_id=user.id)
    await db.commit()
    loaded = await get_job_model_by_id(db, model.id)
    return JobModelResponse.model_validate(loaded)


@model_router.delete("/{job_model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_model(job_model_id: uuid.UUID, db: DbSession, _user: CurrentUser) -> Response:
    model = await get_job_model_by_id(db, job_model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Job model not found")
    await delete_job_model(db, model)
    await db.commit()
    return Response(status_code=204)
```

- [ ] **Step 6: 运行后端测试确认通过**

Run: `cd backend && PYTHONPATH=src uv run python -m pytest tests/job_models/test_service.py tests/job_models/test_router.py -k "job_model or version or delete" -v`

Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add backend/src/app/job_models/schemas.py backend/src/app/job_models/service.py backend/src/app/job_models/router.py backend/tests/job_models/test_service.py backend/tests/job_models/test_router.py
git commit -m "refactor: move job model APIs to model and version routes"
```

---

### Task 3: 标准推荐与企业派生接口去项目化

**Files:**
- Modify: `backend/src/app/job_models/service.py`
- Modify: `backend/src/app/job_models/router.py`
- Test: `backend/tests/job_models/test_fast_create_phase1.py`
- Test: `backend/tests/job_models/test_router.py`

- [ ] **Step 1: 先写派生接口失败测试**

```python
async def test_create_enterprise_copy_returns_job_model_and_version(client, auth_headers, standard_model):
    response = await client.post(
        f"/api/job-models/models/{standard_model.id}/create-enterprise-copy",
        json={"job_role": "某企业 Java 后端工程师", "version_note": "企业校准初版"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert "job_model_id" in data
    assert "version_id" in data
    assert "project_id" not in data
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && PYTHONPATH=src uv run python -m pytest tests/job_models/test_fast_create_phase1.py -k create_enterprise_copy_returns_job_model_and_version -v`

Expected: FAIL，返回仍含 `project_id`

- [ ] **Step 3: 修改派生 service**

```python
async def create_enterprise_model_from_standard(
    db: AsyncSession,
    standard_model: JobModel,
    *,
    job_role: str,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    version_note: str | None = None,
) -> tuple[JobModel, JobModelVersion]:
    enterprise_model = JobModel(
        job_role=job_role,
        model_type="enterprise",
        status="draft",
        job_family=standard_model.job_family,
        industry_name=standard_model.industry_name,
        direction_name=standard_model.direction_name,
        org_id=org_id,
        created_by=user_id,
        origin_standard_model_id=standard_model.id,
    )
    db.add(enterprise_model)
    await db.flush()

    version = await clone_version_tree(
        db,
        source_version_id=standard_model.current_version_id,
        target_job_model_id=enterprise_model.id,
        source_type="standard_based",
        version_note=version_note,
    )
    enterprise_model.current_version_id = version.id
    await db.flush()
    return enterprise_model, version
```

- [ ] **Step 4: 修改派生接口返回**

```python
class EnterpriseCopyResponse(BaseModel):
    job_model_id: uuid.UUID
    version_id: uuid.UUID


@model_router.post("/{job_model_id}/create-enterprise-copy", response_model=EnterpriseCopyResponse, status_code=201)
async def create_enterprise_copy(...):
    enterprise_model, version = await create_enterprise_model_from_standard(...)
    await db.commit()
    return EnterpriseCopyResponse(job_model_id=enterprise_model.id, version_id=version.id)
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd backend && PYTHONPATH=src uv run python -m pytest tests/job_models/test_fast_create_phase1.py tests/job_models/test_router.py -k "enterprise_copy or recommend_standard" -v`

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/src/app/job_models/service.py backend/src/app/job_models/router.py backend/tests/job_models/test_fast_create_phase1.py backend/tests/job_models/test_router.py
git commit -m "refactor: remove project ids from fast create APIs"
```

---

### Task 4: 前端路由与跳转统一改为 jobModelId + versionId

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/job-models/list.tsx`
- Modify: `frontend/src/pages/job-models/standard-library.tsx`
- Modify: `frontend/src/pages/job-models/fast-create.tsx`
- Modify: `frontend/src/pages/job-models/create.tsx`
- Test: `frontend/src/pages/job-models/list.test.ts`
- Test: `frontend/src/pages/job-models/standard-library.test.tsx`
- Test: `frontend/src/pages/job-models/fast-create.test.tsx`

- [ ] **Step 1: 先写前端跳转失败测试**

```tsx
it("navigates standard library details with job model and version route", async () => {
  render(<StandardLibraryPage />)
  fireEvent.click(await screen.findByRole("button", { name: "查看详情" }))
  expect(mockNavigate).toHaveBeenCalledWith("/gwmx/job-models/model-1/versions/version-1/editor")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && pnpm vitest run src/pages/job-models/standard-library.test.tsx`

Expected: FAIL，仍跳转到旧 `project_id` 路由

- [ ] **Step 3: 更新路由定义**

```tsx
<Route
  path="/gwmx/job-models/:jobModelId/versions/:versionId/editor"
  element={<JobModelEditor />}
/>
```

- [ ] **Step 4: 更新列表和标准库字段映射**

```tsx
type JobModelCard = {
  id: string
  current_version_id: string
  job_role: string
  industry_name?: string
  direction_name?: string
}

navigate(`/gwmx/job-models/${model.id}/versions/${model.current_version_id}/editor`)
```

- [ ] **Step 5: 更新快速生成与创建页跳转**

```tsx
const created = (await response.json()) as { job_model_id: string; version_id: string }
navigate(`/gwmx/job-models/${created.job_model_id}/versions/${created.version_id}/editor`)
```

- [ ] **Step 6: 运行前端测试确认通过**

Run: `cd frontend && pnpm vitest run src/pages/job-models/list.test.ts src/pages/job-models/standard-library.test.tsx src/pages/job-models/fast-create.test.tsx`

Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add frontend/src/App.tsx frontend/src/pages/job-models/list.tsx frontend/src/pages/job-models/standard-library.tsx frontend/src/pages/job-models/fast-create.tsx frontend/src/pages/job-models/create.tsx frontend/src/pages/job-models/list.test.ts frontend/src/pages/job-models/standard-library.test.tsx frontend/src/pages/job-models/fast-create.test.tsx
git commit -m "refactor: switch job model frontend routes to version-based paths"
```

---

### Task 5: 编辑器适配新版本路由与版本实体

**Files:**
- Modify: `frontend/src/pages/job-models/editor/index.tsx`
- Modify: `frontend/src/pages/job-models/editor/content-panel.tsx`
- Modify: `frontend/src/pages/job-models/editor/properties-panel.tsx`
- Test: `frontend/src/pages/job-models/editor/properties-panel.test.tsx`

- [ ] **Step 1: 先写编辑器删除调用失败测试**

```tsx
it("deletes the current job model from the editor", async () => {
  window.confirm = vi.fn(() => true)
  render(<PropertiesPanel selectedNodeId="node-1" jobModelId="model-1" versionId="version-1" />)
  fireEvent.click(screen.getByRole("button", { name: "删除岗位模型" }))
  expect(fetch).toHaveBeenCalledWith("/api/job-models/models/model-1", expect.objectContaining({ method: "DELETE" }))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && pnpm vitest run src/pages/job-models/editor/properties-panel.test.tsx`

Expected: FAIL，仍调用旧接口或缺少 `jobModelId`

- [ ] **Step 3: 更新编辑器参数读取**

```tsx
const { jobModelId, versionId } = useParams<{
  jobModelId: string
  versionId: string
}>()
```

- [ ] **Step 4: 更新编辑器数据读写接口**

```tsx
await fetch(`/api/job-models/models/${jobModelId}/versions/${versionId}`, {
  headers: authHeaders,
})
```

- [ ] **Step 5: 更新删除按钮语义**

```tsx
if (confirm("确定要删除这个岗位模型吗？")) {
  await fetch(`/api/job-models/models/${jobModelId}`, { method: "DELETE", headers: authHeaders })
  toast({ title: "已删除岗位模型" })
  navigate("/gwmx/job-models")
}
```

- [ ] **Step 6: 运行编辑器测试确认通过**

Run: `cd frontend && pnpm vitest run src/pages/job-models/editor/properties-panel.test.tsx`

Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add frontend/src/pages/job-models/editor/index.tsx frontend/src/pages/job-models/editor/content-panel.tsx frontend/src/pages/job-models/editor/properties-panel.tsx frontend/src/pages/job-models/editor/properties-panel.test.tsx
git commit -m "refactor: adapt job model editor to model version routing"
```

---

### Task 6: 删除岗位模型入口与标准 seed 脚本切到新结构

**Files:**
- Modify: `frontend/src/pages/job-models/list.tsx`
- Modify: `frontend/src/pages/job-models/standard-library.tsx`
- Modify: `backend/scripts/seed_standard_job_models.py`
- Test: `frontend/src/pages/job-models/list.test.ts`

- [ ] **Step 1: 先写岗位库删除按钮失败测试**

```tsx
it("deletes a model from standard library and removes it from the list", async () => {
  window.confirm = vi.fn(() => true)
  render(<StandardLibraryPage />)
  fireEvent.click(await screen.findByRole("button", { name: "删除" }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/job-models/models/model-1", expect.objectContaining({ method: "DELETE" })))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd frontend && pnpm vitest run src/pages/job-models/list.test.ts src/pages/job-models/standard-library.test.tsx`

Expected: FAIL，页面还没有删除入口

- [ ] **Step 3: 在岗位库和列表页加删除按钮**

```tsx
<Button
  variant="ghost"
  size="sm"
  className="h-8 px-3 text-xs text-destructive"
  onClick={async (event) => {
    event.stopPropagation()
    if (!confirm(`确定删除“${model.job_role}”吗？`)) return
    await fetch(`/api/job-models/models/${model.id}`, { method: "DELETE", headers: authHeaders })
    setModels((current) => current.filter((item) => item.id !== model.id))
    toast({ title: "已删除岗位模型" })
  }}
>
  删除
</Button>
```

- [ ] **Step 4: 重写标准 seed 脚本**

```python
model = JobModel(
    job_role=definition["job_role"],
    model_type="standard",
    status="published",
    job_family=definition["job_family"],
    industry_name=definition["industry_name"],
    direction_name=definition["direction_name"],
    org_id=org.id,
)
db.add(model)
await db.flush()

version = JobModelVersion(
    job_model_id=model.id,
    version=1,
    version_note=definition["version_note"],
    source_type="manual",
    is_current=True,
)
db.add(version)
await db.flush()
model.current_version_id = version.id
```

- [ ] **Step 5: 运行前端测试和脚本编译**

Run: `cd frontend && pnpm vitest run src/pages/job-models/list.test.ts src/pages/job-models/standard-library.test.tsx`

Expected: PASS

Run: `cd backend && PYTHONPATH=src python -m py_compile scripts/seed_standard_job_models.py`

Expected: no output

- [ ] **Step 6: 提交**

```bash
git add frontend/src/pages/job-models/list.tsx frontend/src/pages/job-models/standard-library.tsx frontend/src/pages/job-models/list.test.ts backend/scripts/seed_standard_job_models.py
git commit -m "feat: add job model deletion and reseed standards on new schema"
```

---

### Task 7: 最终迁移、真实 seed 与全链路验证

**Files:**
- Modify: `docs/superpowers/specs/2026-04-12-job-model-fast-create-design.md`
- Modify: `docs/superpowers/plans/2026-04-12-job-model-fast-create-implementation.md`

- [ ] **Step 1: 升级数据库到新迁移**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run alembic upgrade head`

Expected: migration runs without error

- [ ] **Step 2: 执行新的标准岗位 seed**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python scripts/seed_standard_job_models.py`

Expected:

```text
Created standard model: Java 后端工程师
Created standard model: 数据分析师
Created standard model: 设备运维工程师
Done. Created 3 standard job models.
```

- [ ] **Step 3: 运行后端针对性测试**

Run: `cd backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run python -m pytest tests/job_models/test_models.py tests/job_models/test_service.py tests/job_models/test_router.py tests/job_models/test_fast_create_phase1.py -v`

Expected: PASS

- [ ] **Step 4: 运行前端测试**

Run: `cd frontend && pnpm vitest run src/pages/job-models/list.test.ts src/pages/job-models/standard-library.test.tsx src/pages/job-models/fast-create.test.tsx src/pages/job-models/editor/properties-panel.test.tsx`

Expected: PASS

- [ ] **Step 5: 运行前端构建**

Run: `cd frontend && pnpm build`

Expected: PASS

- [ ] **Step 6: 更新相关文档**

```md
- 将所有 `project_id` 相关描述改为 `job_model_id + version_id`
- 将“删除项目”文案改为“删除岗位模型”
- 更新 fast-create 返回结构说明
```

- [ ] **Step 7: 提交**

```bash
git add docs/superpowers/specs/2026-04-12-job-model-fast-create-design.md docs/superpowers/plans/2026-04-12-job-model-fast-create-implementation.md
git commit -m "docs: update job model fast create docs for deprojected architecture"
```

---

## Self-Review

### Spec coverage

已覆盖：

1. `JobModel + JobModelVersion` 两层结构
2. 去掉 `Project`
3. 标准与企业模型独立主实体
4. 来源标准模型字段
5. 前端路由去掉 `projectId`
6. 删除岗位模型功能
7. 新 seed 与验证路径

### Placeholder scan

已检查：

1. 无 `TODO` / `TBD`
2. 每个任务都有明确文件
3. 每个任务都有明确测试命令

### Type consistency

已统一使用以下命名：

1. `jobModelId`
2. `versionId`
3. `current_version_id`
4. `JobModelVersion`
5. `origin_standard_model_id`
