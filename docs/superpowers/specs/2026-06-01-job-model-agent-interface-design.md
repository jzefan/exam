# Job Model Agent Interface Design

## Goal

Expose job model data through a stable integration boundary so external agents and enterprise systems can search, read, generate, calibrate, and eventually update job competency models without depending on UI-specific APIs or direct database access.

## Recommendation

Use two layers:

1. REST/OpenAPI as the authoritative integration contract.
2. MCP as an agent-friendly adapter over the REST contract.

The REST layer remains the source of truth for authentication, organization scope, validation, versioning, and audit. MCP should translate agent tool calls into the REST contract rather than bypassing application services.

## Phase 1 REST Surface

Add `/api/agent/job-models` with read-first operations:

- `GET /api/agent/job-models`: search and page job models by keyword, model type, industry, direction.
- `GET /api/agent/job-models/{model_id}`: return one full job model with current version, dimensions, skills, and knowledge points.
- `GET /api/agent/job-models/{model_id}/export?format=json|markdown`: export a model in machine-readable JSON or agent-readable Markdown.
- `POST /api/agent/job-models/recommend-standard`: recommend a standard model from a JD or free text.

These endpoints use the existing Bearer token authentication and `X-Org-Id` organization context.

## Phase 2 Write Surface

Add safe write operations:

- Create draft model from structured payload.
- Update draft structure in a batch operation.
- Generate a preview diff before applying changes.
- Publish a new version only through an explicit publish endpoint.

Agent write calls should support preview mode so a caller can inspect changes before committing them.

## Phase 3 MCP Surface

Add an MCP server that exposes:

- Resources: job model list, model detail, version detail.
- Tools: search, get, export, recommend, create draft, preview update, publish.
- Prompts: JD-to-model generation, enterprise calibration, curriculum mapping.

MCP should authenticate against the same backend boundary and reuse the REST/OpenAPI contract.

## Arkloop Smart Paper Extension

The same MCP boundary also supports Arkloop's smart paper workflow. External Arkloop agents call MCP tools such as `exam_list_knowledge_points`, `exam_list_questions`, `exam_save_questions`, and `exam_create_paper`; the MCP adapter then calls this project's REST/OpenAPI endpoints.

This keeps the desired chain intact:

```text
Arkloop agent
  -> Exam MCP Server
    -> Exam REST/OpenAPI or backend service
      -> permission / organization isolation / versioning / audit
        -> PostgreSQL
```

The MCP adapter may translate Arkloop-friendly fields into current backend schemas, for example mapping `single_choice` and `multi_choice` to `choice`, and mapping `easy` / `medium` / `hard` to the backend numeric difficulty scale.

## Non-Goals

- Do not expose direct database access to external agents.
- Do not let MCP own business rules.
- Do not expose every UI editing endpoint as an external contract.
- Do not make destructive write operations available without preview or audit.
