# Question Edit Lock And Regrading Design

## Goal

When a question is already used by one or more exams or practices, lock all student-visible structure fields from editing, while still allowing teachers to update grading-related metadata. If the teacher changes the answer key or code-question test cases, the system should automatically regrade already submitted students for every affected exam that still references that question.

## Scope

This spec covers:

- Teacher-side question edit UI behavior for in-use questions
- Backend enforcement of allowed vs forbidden fields
- Regrading trigger rules when grading-affecting fields change
- Regrading scope for already submitted students
- Audit-safe behavior for ongoing and completed exams

This spec does not cover:

- Bulk question editing
- Historical version browsing for question revisions
- Cross-question score normalization
- New student-side messaging beyond existing grading-status and station-message patterns

## Confirmed Rules

### Allowed edits for in-use questions

If a question is referenced by any non-deleted exam or practice, teachers may still edit:

- `answer`
- `analysis`
- `difficulty`
- `knowledge_point_ids`
- code-question test cases inside `content`

### Forbidden edits for in-use questions

If a question is referenced by any non-deleted exam or practice, teachers may not edit fields that change what students saw or how they answered:

- `type`
- `title`
- question body / prompt text in `content`
- `options`
- `score`
- any other `content` subfields except code-question test cases

This means the student-facing wording, structure, and scoring weight are locked once the question is in use.

### Regrading triggers

Changing these fields must trigger regrading of already submitted students:

- `answer`
- code-question test cases

Changing these fields must **not** trigger regrading:

- `analysis`
- `difficulty`
- `knowledge_point_ids`

## Product Behavior

### Teacher-side edit page

When the teacher opens a question that is referenced by any non-deleted exam or practice:

- Show a top-of-page warning banner:
  - `这道题正在某些考试或练习中使用，题目内容已锁定。你仍可修改答案、解析、难度、知识点标签和编程题测试用例。`
- If the question also affects already submitted students, append a secondary hint:
  - `修改答案或编程题测试用例后，系统会自动重新评分已提交的考生答卷。`

Locked fields should be visually disabled in the form rather than allowing the teacher to edit and failing only on save.

Allowed fields remain editable.

### Save behavior

If the teacher changes only allowed, non-regrading fields:

- Save succeeds normally
- Show normal success toast

If the teacher changes `answer` or code-question test cases:

- Save succeeds
- Show success toast with background follow-up message:
  - `题目已保存，系统正在重新评分受影响的考生答卷。`

If the teacher somehow submits forbidden changes anyway, backend returns a validation error and front-end shows a clear Chinese message:

- `这道题正在考试或练习中使用，不能修改题干、选项、题型或分值。`

## Backend Design

### Core detection: is question in use

A question is considered “in use” if it is referenced by at least one `exam_questions` row whose parent `exams.deleted_at IS NULL`.

This includes:

- draft-disabled? No. Only actual exam references matter.
- ongoing exams
- completed exams
- soft-deleted question banks do not matter

The lock is based on active exam references, not historical answer tables alone.

### Field-level enforcement

Add a backend guard before persisting question updates:

1. Load current stored question
2. Determine whether the question is in use
3. Compute which fields are being changed
4. If not in use:
   - allow all current editable fields
5. If in use:
   - allow only:
     - `answer`
     - `analysis`
     - `difficulty`
     - `knowledge_point_ids`
     - code-question test cases in `content`
   - reject all other changes

### Code-question special rule

For code questions, `content` is partly locked and partly editable:

- editable:
  - public/private test case definitions used for judging
- locked:
  - mode
  - description
  - input/output description
  - examples
  - starter code
  - function-mode structure
  - any other student-visible content

Implementation should compare current `content` and incoming `content`, and allow only the test-case subtree to change for `QuestionType.CODE`.

### Helper decomposition

Introduce focused backend helpers instead of burying everything in `update_question`:

- `question_is_in_use(question_id)`
- `diff_question_update(current_question, incoming_update)`
- `validate_in_use_question_update(...)`
- `question_update_requires_regrade(...)`

Each helper should have a narrow responsibility and dedicated tests.

## Regrading Design

### Which submissions are affected

When regrading is triggered, target every submitted student attempt that still belongs to an exam referencing this question:

- referenced exam is not soft-deleted
- student has submitted that exam
- include ongoing exams with submitted attempts
- include completed exams

Do not regrade:

- students who never submitted
- draft answers only
- deleted exams

### Source of truth for regrading

Reuse existing grading pipeline as much as possible. The new logic should not invent a parallel grading system.

For each affected submitted attempt:

- objective questions: recompute the changed question score and total score
- code questions: rerun grading for that code question using the latest test cases / answer standard
- subjective questions:
  - if current system uses AI or manual grading states, preserve the same pipeline semantics
  - but answer-key changes for subjective questions should still mark the attempt for refreshed grading if the question type supports automatic score derivation

### Existing data structures

The system already stores:

- current student answers
- submission history snapshots
- grading status fields

Regrading should update the current effective student-exam state and append or refresh grading-task state as needed, without deleting submission history.

### Execution model

Regrading must be asynchronous.

Teacher save should never block on recomputing all affected students.

Flow:

1. Teacher saves question update
2. Backend commits question changes
3. Backend enqueues a background regrading job for affected attempts
4. UI returns success immediately

If the system already has an async grading task model, reuse it instead of creating a second queue abstraction.

### Status updates

For affected attempts:

- If regrading is required, move them back into an appropriate “pending grading” or “AI grading” status depending on question type and pipeline behavior
- Once regrading finishes, final score and status update as usual

This should be consistent with current student result-page semantics and existing grading-status labels.

## Student Impact

Students do not need a new special flow.

Expected behavior:

- historical submitted results may update after teacher changes answer key or code test cases
- if the result is still being recalculated, existing grading/pending states continue to represent that

No new blocking UI is required on the student side for this feature.

## Error Handling

### Forbidden edit attempt

If a teacher attempts to change locked fields on an in-use question:

- backend returns `400`
- detail message:
  - `这道题正在考试或练习中使用，不能修改题干、选项、题型或分值。`

### Regrading enqueue failure

If question save succeeds but background regrading enqueue fails:

- save must still persist
- backend should log the failure with affected question and exam identifiers
- front-end should show a softer warning:
  - `题目已保存，但重新评分任务提交失败，请联系管理员检查。`

This avoids losing the valid content change while making the follow-up operational issue visible.

## Testing Strategy

### Backend tests

Add coverage for:

1. Question not in use:
   - full edit allowed

2. Question in use:
   - answer-only edit allowed
   - analysis-only edit allowed
   - difficulty-only edit allowed
   - knowledge point updates allowed
   - code test-case-only edit allowed

3. Question in use forbidden edits:
   - title change rejected
   - content prompt change rejected
   - options change rejected
   - type change rejected
   - score change rejected

4. Regrading trigger detection:
   - answer change triggers
   - code test-case change triggers
   - analysis/difficulty/knowledge-point change does not trigger

5. Affected-attempt selection:
   - submitted attempts included
   - unsubmitted attempts excluded
   - soft-deleted exams excluded

6. Async enqueue path:
   - enqueue invoked after successful save
   - failure path returns warning-ready response semantics or logs properly

### Frontend tests

Add coverage for:

1. In-use question edit page:
   - warning banner shown
   - locked fields disabled
   - allowed fields still editable

2. Save behavior:
   - normal save toast for metadata-only changes
   - regrade toast for answer/test-case changes

3. Forbidden edit response:
   - clear Chinese error shown

## Implementation Notes

### Existing likely touchpoints

Backend:

- `backend/src/app/questions/router.py`
- `backend/src/app/questions/service.py`
- question schemas/models as needed
- grading/regrading task orchestration modules

Frontend:

- `frontend/src/pages/questions/edit.tsx`
- any shared question form utilities

### Non-goals for this iteration

- detailed audit log UI for “who retriggered regrading”
- question revision history
- selective per-exam opt-out of regrading
- partial manual review workflow redesign

## Recommendation

Use strict backend enforcement with a narrow teacher-side whitelist. Treat answer-key and code-test-case edits as grading-standard changes, save them immediately, and trigger asynchronous regrading for already submitted students. This keeps running and historical exams consistent without allowing student-visible exam content to drift after release.
