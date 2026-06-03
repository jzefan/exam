# Job Course Graph Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first vertical slice of the 岗位-课程全景图谱工作台 so `/gwmx/job-models` defaults to a graph canvas where users can see jobs, courses, skill-course mappings, focus a job/course, create/delete mappings, and save shared layout.

**Architecture:** Keep the existing job model tree data intact and add graph-specific aggregation APIs plus two new persistence models: skill-course mappings and graph layouts. The frontend introduces a graph-first page that uses React Flow for pan/zoom, cards, focus states, mapping edges, and a side detail panel, while preserving the existing list page as a fallback/management view.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, pytest, React, TypeScript, Vite/Vitest, @xyflow/react, Tailwind CSS.

---

## Parallel Work Split

This feature can be split into mostly independent tasks:

- **Backend graph contract:** Owns `backend/src/app/job_models/graph_*`, SQLAlchemy graph models, migration, and backend tests.
- **Frontend graph shell:** Owns `frontend/src/pages/job-models/graph-*` and graph workspace tests using mocked API responses.
- **Route integration:** Owns only `frontend/src/App.tsx` and the preserved list entry behavior after backend/frontend contracts exist.
- **Verification worker:** Owns no source edits unless asked; runs focused backend/frontend checks and reports failures.

Workers must not revert unrelated dirty files. Current unrelated dirty files include previous agent interface files and exam analysis changes.

## File Structure

- Create `backend/src/app/job_models/graph_schemas.py`: Pydantic request/response DTOs for overview, focus payloads, mappings, and layouts.
- Create `backend/src/app/job_models/graph_service.py`: Query aggregation, mapping mutation rules, and layout persistence.
- Create `backend/src/app/job_models/graph_router.py`: `/api/job-models/graph/*` endpoints.
- Modify `backend/src/app/job_models/models.py`: add `SkillCourseMapping`, `JobModelGraphLayout`, and extend `SkillKpMapping` metadata fields.
- Modify `backend/src/app/main.py`: include graph router under `/api/job-models/graph`.
- Create `backend/alembic/versions/20260602_job_course_graph.py`: migration for mappings/layouts and `skill_kp_mappings` metadata.
- Create `backend/tests/job_models/test_graph_router.py`: integration tests for overview/focus/mapping/layout.
- Create `frontend/src/pages/job-models/graph-types.ts`: frontend graph API types.
- Create `frontend/src/pages/job-models/graph-api.ts`: fetch helpers with auth token.
- Create `frontend/src/pages/job-models/graph-workspace.tsx`: graph-first page and state orchestration.
- Create `frontend/src/pages/job-models/graph-workspace.test.tsx`: mocked API UI tests.
- Create `frontend/src/pages/job-models/graph/node-components.tsx`: job/course/skill/course-kp visual nodes.
- Create `frontend/src/pages/job-models/graph/detail-panel.tsx`: right panel for selected job, skill, course, mapping.
- Modify `frontend/src/App.tsx`: route `/gwmx/job-models` to graph workspace.

## Task 1: Backend Graph Models And Overview Contract

**Files:**
- Modify: `backend/src/app/job_models/models.py`
- Create: `backend/src/app/job_models/graph_schemas.py`
- Create: `backend/tests/job_models/test_graph_router.py`

- [ ] **Step 1: Write failing overview test**

Add a test that creates one job model with one dimension, one skill, one skill knowledge point, one root knowledge point course, and one child knowledge point. The test calls `GET /api/job-models/graph/overview` and expects `jobs`, `courses`, `skill_course_mappings`, and `layout` fields.

Run: `cd backend && uv run pytest tests/job_models/test_graph_router.py::test_graph_overview_returns_jobs_courses_and_empty_mappings -q`

Expected: FAIL because `graph_router` does not exist or route returns 404.

- [ ] **Step 2: Add graph schema DTOs**

Define DTOs in `graph_schemas.py`:

```python
class GraphJobCard(BaseModel): ...
class GraphCourseCard(BaseModel): ...
class GraphSkillSummary(BaseModel): ...
class GraphSkillCourseMapping(BaseModel): ...
class GraphLayoutPayload(BaseModel): ...
class GraphOverviewResponse(BaseModel): ...
```

The overview response must include:

```python
jobs: list[GraphJobCard]
courses: list[GraphCourseCard]
skills: list[GraphSkillSummary]
skill_course_mappings: list[GraphSkillCourseMapping]
layout: GraphLayoutPayload | None
```

- [ ] **Step 3: Add persistence models**

Add `SkillCourseMapping` with UUID primary key and fields:

```python
skill_id
course_root_knowledge_point_id
relation_type = "required"
match_type = "manual"
status = "confirmed"
created_by
deleted_at
```

Add `JobModelGraphLayout` with:

```python
scope_type
scope_id
layout_json
updated_by
```

Extend `SkillKpMapping` with:

```python
relation_type = "required"
status = "confirmed"
created_by
deleted_at
```

- [ ] **Step 4: Run model test red-to-green**

Run: `cd backend && uv run pytest tests/job_models/test_models.py tests/job_models/test_graph_router.py::test_graph_overview_returns_jobs_courses_and_empty_mappings -q`

Expected: overview still fails until router/service are added, model tests should not regress.

## Task 2: Backend Graph Service And Router

**Files:**
- Create: `backend/src/app/job_models/graph_service.py`
- Create: `backend/src/app/job_models/graph_router.py`
- Modify: `backend/src/app/main.py`
- Test: `backend/tests/job_models/test_graph_router.py`

- [ ] **Step 1: Implement minimal overview service**

`get_graph_overview(db, org_id)` should:

- Load job models for the current org.
- Load current version dimensions/skills.
- Count skill knowledge points per skill.
- Load root knowledge points where `KnowledgePoint.parent_id.is_(None)`.
- Count direct and descendant child knowledge points per course using Python traversal for the first version.
- Count learning resources for course nodes from `LearningResource` where `node_type == "kp"`.
- Load non-deleted confirmed/suggested `SkillCourseMapping`.
- Load org overview layout where `scope_type == "org_overview"` and `scope_id == org_id`.

- [ ] **Step 2: Implement graph router**

Expose:

```text
GET /api/job-models/graph/overview
GET /api/job-models/graph/jobs/{job_model_id}
GET /api/job-models/graph/courses/{course_root_kp_id}
POST /api/job-models/graph/skill-course-mappings
DELETE /api/job-models/graph/skill-course-mappings/{mapping_id}
PUT /api/job-models/graph/layouts/{scope_type}/{scope_id}
```

All endpoints use `CurrentUser` and `get_db`. Org scope comes from `UserOrganization.is_primary == True`.

- [ ] **Step 3: Wire router**

Import `router as graph_job_model_router` and include it:

```python
app.include_router(graph_job_model_router, prefix="/api/job-models/graph", tags=["job-model-graph"])
```

- [ ] **Step 4: Run overview test**

Run: `cd backend && uv run pytest tests/job_models/test_graph_router.py::test_graph_overview_returns_jobs_courses_and_empty_mappings -q`

Expected: PASS.

## Task 3: Backend Mapping And Layout Behavior

**Files:**
- Modify: `backend/src/app/job_models/graph_service.py`
- Modify: `backend/src/app/job_models/graph_router.py`
- Modify: `backend/src/app/job_models/graph_schemas.py`
- Modify: `backend/tests/job_models/test_graph_router.py`

- [ ] **Step 1: Write failing skill-course mapping test**

Test `POST /api/job-models/graph/skill-course-mappings` creates one confirmed manual mapping and then overview returns exactly one edge with `source_type == "skill"` and `target_type == "course"`.

Run: `cd backend && uv run pytest tests/job_models/test_graph_router.py::test_create_skill_course_mapping_updates_overview -q`

Expected: FAIL before implementation.

- [ ] **Step 2: Implement create mapping**

Validate:

- Skill exists and belongs to a job model in the current org.
- Course is a root `KnowledgePoint`.
- Duplicate active mappings are rejected with 409.

Return the mapping DTO.

- [ ] **Step 3: Write failing delete cascade test**

Create a skill-course mapping and a `SkillKpMapping` from a skill knowledge point under that skill to a child node under that course. Delete the skill-course mapping and assert both are soft-deleted.

Run: `cd backend && uv run pytest tests/job_models/test_graph_router.py::test_delete_skill_course_mapping_soft_deletes_related_kp_mappings -q`

Expected: FAIL before cascade.

- [ ] **Step 4: Implement delete cascade**

Soft-delete `SkillCourseMapping.deleted_at`. For all `SkillKpMapping` rows whose `skill_kp.skill_id == mapping.skill_id` and whose mapped `KnowledgePoint` belongs to the deleted course tree, set `deleted_at`.

- [ ] **Step 5: Write failing layout test**

Test `PUT /api/job-models/graph/layouts/org_overview/{org_id}` saves JSON positions and `GET overview` returns the same layout.

Run: `cd backend && uv run pytest tests/job_models/test_graph_router.py::test_save_org_overview_layout_round_trips -q`

Expected: FAIL before layout persistence.

- [ ] **Step 6: Implement layout persistence**

Accept only `scope_type in {"org_overview", "job_model_version"}`. Upsert by `(scope_type, scope_id)` and store `layout_json`.

- [ ] **Step 7: Run backend focused suite**

Run: `cd backend && uv run pytest tests/job_models/test_graph_router.py tests/job_models/test_models.py -q`

Expected: PASS.

## Task 4: Backend Migration

**Files:**
- Create: `backend/alembic/versions/20260602_job_course_graph.py`

- [ ] **Step 1: Create migration file**

Create `skill_course_mappings`, `job_model_graph_layouts`, indexes, uniqueness constraints for active duplicate prevention where supported, and nullable metadata columns on `skill_kp_mappings`.

- [ ] **Step 2: Run migration smoke test**

Run: `cd backend && uv run alembic upgrade head`

Expected: PASS on local dev database. If the local DB is not configured, run the backend pytest suite instead because tests use metadata creation.

## Task 5: Frontend Graph API Types And Shell

**Files:**
- Create: `frontend/src/pages/job-models/graph-types.ts`
- Create: `frontend/src/pages/job-models/graph-api.ts`
- Create: `frontend/src/pages/job-models/graph-workspace.test.tsx`
- Create: `frontend/src/pages/job-models/graph-workspace.tsx`

- [ ] **Step 1: Write failing graph workspace loading test**

Mock `fetch` for `/api/job-models/graph/overview` and assert the page renders:

- `岗位-课程图谱`
- one job card name
- one course card name
- `切换到列表`

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx`

Expected: FAIL because file/component does not exist.

- [ ] **Step 2: Add frontend graph types**

Define `GraphOverview`, `GraphJobCard`, `GraphCourseCard`, `GraphSkillSummary`, `GraphSkillCourseMapping`, and layout types matching backend DTOs.

- [ ] **Step 3: Add graph fetch helpers**

Implement `getGraphOverview`, `getGraphJobFocus`, `getGraphCourseFocus`, `createSkillCourseMapping`, `deleteSkillCourseMapping`, and `saveGraphLayout` using the same token pattern as existing pages.

- [ ] **Step 4: Add minimal graph workspace**

Render a graph-first page with:

- Header title `岗位-课程图谱`.
- Action buttons: `切换到列表`, `标准岗位库`, `企业快速生成`, `保存布局`, `自动排版`.
- Loading and empty states.
- A canvas region with job/course cards and mapping edges.
- A right detail panel placeholder driven by selected node.

- [ ] **Step 5: Run frontend test**

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx`

Expected: PASS.

## Task 6: Frontend React Flow Panorama

**Files:**
- Modify: `frontend/src/pages/job-models/graph-workspace.tsx`
- Create: `frontend/src/pages/job-models/graph/node-components.tsx`
- Create: `frontend/src/pages/job-models/graph/detail-panel.tsx`
- Modify: `frontend/src/pages/job-models/graph-workspace.test.tsx`

- [ ] **Step 1: Write failing focus test**

Assert clicking a job card shows its skills and a detail panel title `岗位详情`; clicking a course card shows `课程详情`.

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx`

Expected: FAIL before focus logic.

- [ ] **Step 2: Implement React Flow nodes**

Use `@xyflow/react` with node types:

- `jobCard`
- `courseCard`
- `skillCard`
- `courseKnowledgePoint`

Default auto-layout:

- Jobs on the left in grouped card clusters.
- Courses on the right in grouped card clusters.
- Skills expand around selected job.
- Course first-level children expand under selected course.

- [ ] **Step 3: Implement focus visual rules**

When a job is selected:

- selected job enlarged
- selected job skills visible
- mapped courses bright
- unrelated courses muted

When a course is selected:

- selected course enlarged
- first-level course children visible
- related jobs/skills bright
- unrelated context muted

- [ ] **Step 4: Run focus test**

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx`

Expected: PASS.

## Task 7: Frontend Mapping And Layout Interactions

**Files:**
- Modify: `frontend/src/pages/job-models/graph-workspace.tsx`
- Modify: `frontend/src/pages/job-models/graph/detail-panel.tsx`
- Modify: `frontend/src/pages/job-models/graph-workspace.test.tsx`

- [ ] **Step 1: Write failing mapping test**

Mock `POST /api/job-models/graph/skill-course-mappings`. Simulate connecting a skill node to a course node and assert the POST body includes `skill_id` and `course_root_knowledge_point_id`.

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx`

Expected: FAIL before `onConnect`.

- [ ] **Step 2: Implement skill-course connection**

Use React Flow `onConnect`. Accept only skill-to-course or course-to-skill pairs. Reject other pairs with a toast or inline status message.

- [ ] **Step 3: Write failing layout save test**

Move one node in component state, click `保存布局`, assert `PUT /api/job-models/graph/layouts/org_overview/{scopeId}` receives `nodes` positions.

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx`

Expected: FAIL before save handler.

- [ ] **Step 4: Implement layout dirty/save/reset**

Set `layoutDirty` on node drag stop. `保存布局` calls API. `自动排版` recomputes positions and marks dirty.

- [ ] **Step 5: Run frontend focused suite**

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx src/pages/job-models/list.test.ts`

Expected: PASS.

## Task 8: Route Integration And List Fallback

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/job-models/graph-workspace.tsx`
- Test: `frontend/src/pages/job-models/graph-workspace.test.tsx`

- [ ] **Step 1: Write failing route expectation if route tests exist**

If no existing route test covers `/gwmx/job-models`, add component-level test that `GraphWorkspace` can render `JobModelList` when URL search is `?view=list`.

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx`

Expected: FAIL before list fallback.

- [ ] **Step 2: Route default to graph workspace**

Change `const JobModelList` route binding to `JobModelGraphWorkspace` and import list inside the graph workspace as the fallback view.

- [ ] **Step 3: Implement list fallback action**

`切换到列表` should navigate to `/gwmx/job-models?view=list`. In list mode, show a `返回图谱` action that navigates back to `/gwmx/job-models`.

- [ ] **Step 4: Run route-adjacent frontend tests**

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx src/pages/job-models/list.test.ts`

Expected: PASS.

## Task 9: Final Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Backend verification**

Run: `cd backend && uv run pytest tests/job_models/test_graph_router.py tests/job_models/test_models.py tests/job_models/test_router.py -q`

Expected: PASS.

- [ ] **Step 2: Frontend verification**

Run: `cd frontend && pnpm exec vitest run src/pages/job-models/graph-workspace.test.tsx src/pages/job-models/list.test.ts src/pages/job-models/editor/graph-view.test.tsx`

Expected: PASS.

- [ ] **Step 3: Build smoke**

Run: `cd frontend && pnpm exec tsc --noEmit`

Expected: PASS or report existing unrelated TypeScript failures with exact file paths.

## Spec Coverage Check

- P0 graph data aggregation: Tasks 1-3.
- P1 panorama canvas: Tasks 5-6.
- P2 job focus: Task 6.
- P3 course focus: Task 6.
- P4 mapping edit: Tasks 3 and 7.
- P5 layout save: Tasks 3 and 7.
- P6 recommendation mappings: intentionally deferred because the spec says recommendation is not the first-version main experience. The schema supports `match_type` and `status` so suggested mappings can be added without changing the graph contract.
