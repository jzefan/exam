# Job Model Agent Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable job-model integration API and prepare an MCP adapter so external agents can safely read and write job competency models.

**Architecture:** Add a dedicated `/api/agent/job-models` REST layer over existing job model services. Keep business rules inside the backend application boundary, then add MCP tools later as a thin adapter over this contract.

**Tech Stack:** FastAPI, SQLAlchemy async, Pydantic, pytest, httpx ASGI integration tests.

---

### Task 1: Add Agent-Facing REST Schemas

**Files:**
- Create: `backend/src/app/job_models/agent_schemas.py`
- Test: `backend/tests/job_models/test_agent_router.py`

- [ ] Define compact summary, detail, export, and recommendation response schemas.
- [ ] Keep IDs, version fields, model taxonomy, and nested competency structure stable.
- [ ] Avoid leaking UI-only fields or internal helper state.

### Task 2: Add Agent-Facing Service Helpers

**Files:**
- Create: `backend/src/app/job_models/agent_service.py`
- Test: `backend/tests/job_models/test_agent_router.py`

- [ ] Search models by keyword, industry, direction, and type within one organization.
- [ ] Load full model detail by ID and organization.
- [ ] Render Markdown export from the same detail payload.
- [ ] Reuse existing recommendation logic for JD matching.

### Task 3: Add Agent REST Router

**Files:**
- Create: `backend/src/app/job_models/agent_router.py`
- Modify: `backend/src/app/main.py`
- Test: `backend/tests/job_models/test_agent_router.py`

- [ ] Register `/api/agent/job-models`.
- [ ] Add `GET /api/agent/job-models`.
- [ ] Add `GET /api/agent/job-models/{model_id}`.
- [ ] Add `GET /api/agent/job-models/{model_id}/export`.
- [ ] Add `POST /api/agent/job-models/recommend-standard`.

### Task 4: Verify Phase 1

**Files:**
- Test: `backend/tests/job_models/test_agent_router.py`

- [ ] Run focused pytest for the new agent router.
- [ ] Run existing job model router tests to catch regressions.
- [ ] Confirm FastAPI OpenAPI includes the new paths.

### Task 5: Add Safe Write and MCP Later

**Files:**
- To be planned after Phase 1 is stable.

- [ ] Add draft create/update preview endpoints.
- [ ] Add publish endpoint for external agents.
- [ ] Add MCP server adapter over the REST contract.
- [ ] Add integration documentation with example tool calls.

### Task 6: Extend MCP For Arkloop Smart Paper

**Files:**
- Modify: `backend/src/app/job_models/agent_mcp.py`
- Modify: `backend/tests/job_models/test_agent_mcp.py`
- Modify: `docs/job-model-agent-api.md`
- Modify: Arkloop persona and integration docs in `/Users/jzefan/work/proj/Arkloop`

- [x] Add MCP tools for knowledge points, question banks, question lookup, question save, and paper creation.
- [x] Normalize Arkloop-style question payloads to the current backend `QuestionCreate` schema.
- [x] Keep writes behind existing REST endpoints instead of direct database access.
- [x] Update Arkloop prompts so smart-paper agents use MCP as the external boundary.
- [x] Document local stdio launch and secret env configuration for Arkloop profile installs.
