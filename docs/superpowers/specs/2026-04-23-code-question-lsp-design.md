# Code Question Practical LSP Design

Date: 2026-04-23
Status: Draft for review

## Summary

Upgrade the student code-question editor from Monaco + static completions into a practical, VS Code-like single-file coding experience by adding real Language Server Protocol support for all currently supported languages:

- Python
- JavaScript
- Java
- C
- C++
- Go

The student-facing exam flow must not change. There will be no new visible "LSP" concepts, no extra setup steps, and no technical status text in the UI. From the student's perspective, the editor simply becomes smarter.

## Goals

- Provide real language intelligence inside code questions for all supported languages.
- Keep the current exam-taking interaction model unchanged.
- Preserve the existing Monaco-based code editor, per-language code persistence, and online run/judge workflow.
- Keep the solution scoped to single-file exam questions rather than full project workspaces.
- Ensure LSP is an enhancement only; failures must never block coding, running, or submitting answers.

## Non-Goals

- No multi-file project workspace.
- No file tree, tabbed file manager, terminal, or general IDE shell features.
- No user-facing mention of "LSP", "language server", or connection state.
- No rename, go-to-definition, code actions, or refactors in phase 1.
- No support for arbitrary third-party dependency installation in student sessions.

## User Experience

### What the student sees

The current coding workflow remains the same:

- open code question
- select language
- edit code
- run code
- submit exam

The only visible change is that the editor becomes more helpful:

- syntax and type errors show inline diagnostics
- hover shows useful symbol information
- function calls show parameter hints
- completion becomes richer and more context-aware
- document outline/symbol data becomes available for editor features

### What the student does not see

The student must not see:

- "LSP"
- "language server"
- "connecting..."
- "language service unavailable"
- service/container names
- protocol or transport details

If the LSP path fails for any reason, the editor silently falls back to the current Monaco baseline behavior and the student can continue coding normally.

## Scope of Language Features

Phase 1 must deliver the following real LSP-backed capabilities for all six supported languages:

- diagnostics
- completion
- hover
- signature help
- document symbols

These features are required for each language before the feature is considered complete.

The following are explicitly deferred:

- go to definition
- rename
- code actions
- formatting-on-save
- multi-file references
- project-level build graphs

## Architecture

The system is split into three layers.

### 1. Frontend editor layer

The existing student code editor remains built on:

- `@monaco-editor/react`
- Monaco models per `exam/question/language`

The frontend will add:

- `monaco-languageclient`
- per-question, per-language LSP client session management
- WebSocket transport to backend

The frontend will not connect directly to language servers.

### 2. Backend gateway layer

Backend exposes an authenticated WebSocket endpoint for student code-question LSP sessions. Responsibilities:

- authenticate user
- validate exam ownership and answering eligibility
- validate the target question is a code question
- validate requested language is supported
- create and manage proxied LSP session lifecycle
- forward JSON-RPC messages between browser and LSP runner

The backend remains the only network surface visible to the frontend.

### 3. LSP runner layer

A new dedicated `lsp_runner` service is added alongside the existing `judge_runner`.

Responsibilities:

- launch and manage language-server processes
- create temporary single-file workspaces
- map exam/question/language sessions to virtual files
- receive document lifecycle events
- proxy language-server JSON-RPC traffic
- enforce timeouts and idle cleanup

This service is distinct from `judge_runner` because execution and language service have different lifecycles and resource needs.

## Language Servers

Phase 1 uses these concrete language servers:

- Python: `pyright`
- JavaScript: `typescript-language-server`
- Java: `jdtls`
- C/C++: `clangd`
- Go: `gopls`

All six languages must use real language servers. No language may ship with only static completions while others use real LSP.

## Session Model

Each LSP session is uniquely scoped to:

- `student_id`
- `exam_id`
- `question_id`
- `language`

This guarantees:

- language switching creates isolated sessions
- diagnostics do not bleed across languages
- different questions remain isolated
- lifecycle can be safely cleaned up

## Frontend Design

### Monaco integration

Keep the existing code-question component and extend it rather than replacing it.

The frontend will:

- reuse current Monaco model paths, e.g. `file:///student-exam/{examId}/{questionId}/solution.{ext}`
- attach a language client to the active model
- disconnect and dispose the previous client when switching question/language
- preserve per-language code content exactly as it does today

### UI rules

- no new visible LSP status UI
- no new onboarding or instructions about the feature
- no new technical badge or footer
- current editor toolbar remains user-focused only

If LSP is not available, the student still sees the same editor and can continue normally.

## Backend API Design

### WebSocket endpoint

Expose a student-scoped LSP endpoint through backend:

`/api/student/exams/{exam_id}/questions/{question_id}/lsp?language={language}`

### Backend validation rules

Before opening a proxied LSP session, backend must verify:

- authenticated student identity
- the exam belongs to or is visible to the student
- the question is part of the exam
- the question type is `code`
- the exam is still in an answerable state
- the requested language is one of the supported code languages

If validation fails, the socket is rejected.

## LSP Runner Design

### Workspace model

Each session gets a temporary single-file workspace only.

Properties:

- single source file
- per-language extension
- no extra student-managed files
- no shared persistent workspace
- no arbitrary filesystem access beyond controlled temp content

### Lifecycle

Session starts when:

- student opens a code question and LSP client initializes

Session ends when:

- question view unmounts
- language changes
- exam page is left
- idle timeout is reached
- backend explicitly closes the proxied socket

### Resource control

`lsp_runner` must support:

- session idle timeout
- maximum active sessions per student
- process cleanup on disconnect
- per-language startup timeout
- structured logs for startup failure and unexpected process exit

## Relationship to Judge Runner

`judge_runner` remains responsible only for code execution and judging:

- run code
- feed stdin
- return stdout/stderr/compile output

`lsp_runner` is responsible only for editor intelligence:

- diagnostics
- hover
- completion
- signature help
- symbols

This separation is required. The two services have different connection models and should not be merged.

## Failure and Fallback Behavior

LSP must never be a hard dependency for answering.

### If LSP fails

When any of these occur:

- websocket connection failure
- lsp_runner unavailable
- specific language server crash
- session timeout

Then:

- editor remains usable
- current code is preserved
- online run still works
- answer saving still works
- submission still works
- Monaco falls back to current non-LSP behavior

No technical failure text should be shown to the student in phase 1.

## Deployment

Add a new service:

- `lsp_runner`

Deployment stack now includes:

- backend
- frontend
- judge_runner
- lsp_runner
- nginx
- db

### Docker responsibilities

`lsp_runner` image must install and health-check all required language servers for:

- Python
- JavaScript
- Java
- C/C++
- Go

This service needs its own Dockerfile and health checks, separate from `judge_runner`.

## Security and Isolation

Because this is an exam system:

- frontend does not talk directly to internal runner services
- all access goes through backend auth
- lsp sessions are scoped to the active student exam context
- lsp workspace is temporary and single-file
- no broad filesystem browsing
- no shell access through editor features

## Observability

At minimum, backend and `lsp_runner` should log:

- session create
- session close
- language chosen
- startup duration per language server
- startup failures
- unexpected disconnects
- idle cleanup events

These logs are needed because users will not see technical status directly.

## Acceptance Criteria

The feature is complete only when all six languages satisfy all of the following:

- diagnostics appear in-editor for syntax/type issues
- completion is LSP-backed
- hover returns useful symbol information
- signature help appears on function/method calls
- document symbols are available
- student can still run code and submit normally if LSP is unavailable
- no user-facing technical LSP text is introduced

## Implementation Strategy

Internal implementation can proceed incrementally, but product release should only happen once all six languages are wired to real LSP and pass the acceptance criteria.

Suggested build order:

1. Monaco-languageclient integration scaffold
2. backend WebSocket proxy
3. `lsp_runner` session orchestration
4. one language end-to-end validation
5. remaining five languages
6. full fallback verification
7. production deployment integration

## Open Decisions Resolved

The following decisions are intentionally fixed by this spec:

- all supported languages use real LSP
- no user-facing LSP wording
- single-file exam workspace only
- separate `lsp_runner` service
- backend remains the only frontend-facing gateway

