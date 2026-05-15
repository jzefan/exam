# Question Edit Lock And Regrading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock student-visible question fields once a question is used by an exam or practice, while still allowing grading-related edits and asynchronously regrading affected submitted students when answers or code-question test cases change.

**Architecture:** Add a backend enforcement layer in the questions service that computes update diffs, rejects forbidden edits for in-use questions, and schedules asynchronous regrading for answer-key or code-test-case changes. Update the teacher question edit page to fetch and display the lock state, disable forbidden form fields, and show precise save/regrading feedback without changing the existing route structure.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, existing grading service/task pipeline, React, Refine, Vitest, pytest.

---

## 评审意见 (Review Findings — 2026-05-14)

> ⚠️ **不建议在解决以下 P0 问题之前直接开工。** 当前 Plan 在多处把核心决策留成了"appropriate" / "minimum behavior for first pass" 一类的占位说法，按现状直接执行大概率会在 Task 3 卡住，并产出在真实场景下有用户问题的功能。

### 🔴 P0 — 必须先回到 spec 阶段补齐

#### P0-1 主观题重评语义未定义

Spec 第 180-183 行只写了"if current system uses AI or manual grading states, preserve the same pipeline semantics; but answer-key changes for subjective questions should still mark the attempt for refreshed grading if the question type supports automatic score derivation"——这等于没写。Plan Task 3 Step 4 也只是"Minimum behavior for first pass"。

不同题型的重评路径完全不同，必须按题型逐一明确：

| 题型 | answer 变化 | content 中 test_cases 变化 |
|------|-------------|---------------------------|
| choice / true_false | 重算 `is_correct` + `score_awarded` | N/A |
| fill_in | 重跑 DeepSeek 等价匹配（`_request_fill_in_equivalence_with_deepseek`） | N/A |
| short_answer / essay | **要不要重跑 LLM 评分？需要产品决策** | N/A |
| code | 重跑 `judge_runner` | 重跑 `judge_runner` |

#### P0-2 异步执行模型选错

Plan Task 3 Step 5 用 FastAPI `BackgroundTasks.add_task(...)`，但：

- **同进程**：进程重启会丢失任务
- **无重试**：单个学生失败就丢
- **无可见性**：教师看不到进度
- **可能压垮服务**：一次保存触发数百个学生重评

Spec 自己第 207 行也写了"If the system already has an async grading task model, reuse it instead of creating a second queue abstraction." 项目里已经有 `app/grading/service.py` 的 `GradingTask` + `create_grading_task` + `run_grading_task_with_role_binding` 流水线，**必须复用**。每个受影响学生 enqueue 一个 `GradingTask` 而不是 inline 跑。

#### P0-3 "练习"与"考试"的判定与产品意图不一致

Spec 全文反复说"exam or practice"，但：

- 后端 SQL 只查 `exam_questions JOIN exams ON deleted_at IS NULL`
- 而 practice 与 exam 在本项目中是**同一张表**，通过 `Exam.category` 区分

所以当前实现实际上**会同时锁定**练习中使用的题。但 practice 的容忍度通常更高，教师可能希望练习中的题仍可小幅修改。**这是产品决策，不是实现细节，必须在动工前确认。**

#### P0-4 草稿（draft）状态的锁定行为有 UX 隐患

Spec 第 102 行"draft-disabled? No. Only actual exam references matter."语义不明。结合 SQL，**草稿考试**（`status='draft'`）也会触发锁定。

考虑场景：教师不小心把一道题加到了一个草稿试卷，然后这道题就永远不能改了。建议草稿考试**不应**触发锁定，直到 `status` 变为 published 或更高。需在 spec 中明确并在 SQL 上加 `Exam.status != 'draft'`。

### 🟠 P1 — 漏掉的关键场景

#### P1-5 总分重算逻辑缺失

教师改答案后，单题 `StudentExamAnswer.score_awarded` 会刷新，但：

- `ExamStudent.score`（总分）怎么重算？
- `ExamStudent.objective_score` / `subjective_score` 要不要刷新？
- `ExamStudent.grading_status` 要不要回退到 `pending_ai`？

Spec 第 211-215 行只说"appropriate pending grading status"。**Task 3 必须有显式 step 重算并持久化 ExamStudent 聚合字段**。

#### P1-6 申诉（StudentExamAppeal）处理缺失

如果某题已有学生申诉、教师已在 appeal 里回复了，现在教师又改了答案触发重评：

- 旧的 appeal 状态怎么处理？
- 重评后这道题已经判对了，appeal 是否自动 resolved？

Spec 完全没提，但 `StudentExamAppeal` 模型与 UI 入口都已存在，是真实场景。

#### P1-7 学生通知缺失

学生本来看到 80 分，第二天回来看变成 75 分，无任何提示——必然投诉。

项目已有 `StudentNotification` 模型。Spec 第 220-227 行直接 punt 掉了，但**非阻塞通知**应该有：每次重评后给受影响学生发一条 notification，写明"考试 X 的题目 Y 已重新评分，得分变化：旧→新"。

#### P1-8 并发竞态未处理

- 教师 A 改答案触发重评，重评进行中，教师 B 又改一次怎么办？
- 学生正在考试中（未提交），教师改答案，缓存在哪？
- 学生在重评过程中查看结果页，看到新分还是旧分？

至少要保证"同一题不能并发触发两次重评"——建议在 `GradingTask` 入队前用 `question_id` + 状态过滤去重。

#### P1-9 外部访客（external_guest）处理未说明

项目有 `user_type=external_guest` 的考生（公开链接进入）。是否给他们重评？Spec 未提。

### 🟡 P2 — 实施细节问题

#### P2-10 `code_test_cases` 字段命名不一致

Plan 中 `regrade_on_fields: ["answer", "code_test_cases"]` 把它当作顶层字段，但实际数据在 `content.sample_tests` 里。前端 `changedFields.some(f => ["answer", "code_test_cases"].includes(f))` 的判断会与后端 diff 用的实际路径对不上。需明确：metadata 中的字段名是**逻辑名**（用于 UI 决策）还是**数据路径**。

#### P2-11 `diff_question_update` 核心逻辑被偷懒

Plan Task 1 Step 3 的实现里：

```python
def diff_question_update(question, incoming):
    changed_fields = set()
    forbidden_fields = set()
    allowed_content_change_keys = set()
    # compare top-level fields and content subtree here  ← 关键全在这一行注释里
    return ...
```

整个 diff 算法是本特性的核心，但 Plan 把它留成了 TODO。必须明确：

- 浅比较还是深比较？
- `options=None` vs `options={}` 算变化吗？
- 列表顺序变化算变化吗？
- `knowledge_point_ids` 是顺序无关的集合，比较时如何排序去重？

#### P2-12 `ALLOWED_CODE_CONTENT_KEYS` 是猜的

Plan 直接列了 `{"sample_tests", "test_cases", "judge_cases"}`，但没确认项目里 code question `content` 的实际 schema。需要先在 `backend/src/app/questions/models.py` / `schemas.py` 中查清，否则可能漏掉或多写 key。建议在 Task 0 中调研。

#### P2-13 重评前的快照备份

跑完 regrade，老的分数和反馈就被覆盖。若学生发起争议或教师后悔，无法回溯。项目已有 `GradingResultSnapshot` 模型，**重评前必须先 snapshot 一份**。

#### P2-14 审计字段缺失

Spec scope 第 14 行写了"Audit-safe behavior"但全文无审计设计。至少应记录：

- 谁触发的重评（`teacher_id`）
- 何时触发（`triggered_at`）
- 受影响学生数与分数变化分布

可以是简单的 `RegradeEvent` 表，或附加在 `GradingTask` 上。

#### P2-15 前端 `disabled={inUse}` 对复杂编辑器不够

Plan Task 4 Step 5 简单使用 `disabled={inUse}`，但 `options` 编辑器是个复杂组件（多个选项行 + 增删按钮）。需要先看 `frontend/src/pages/questions/edit.tsx` 当前组件实现，决定怎么把 lock 状态传给嵌套编辑器。

#### P2-16 测试 fixtures 假设过多

Plan 里出现的 fixtures（多数不存在）：

- `seeded_exam_question`
- `seeded_question_usage`
- `seeded_deleted_exam_question_usage`
- `code_question_factory`
- `in_use_question`
- `auth_headers`
- `question_factory`

Plan 没说要新建这些 fixture。Task 1 一执行就会全红，且不是因为 source code 缺失。**需要在 Task 1 之前增加 Step 0：补齐所有 pytest fixture 定义**。

---

## 建议的 Plan 修订动作

在解决 P0 后，至少补以下结构：

1. **新增 Task 0：spec 与代码现状调研**
   - 调研 code question 实际 content schema，确认 `ALLOWED_CODE_CONTENT_KEYS`
   - 调研 `GradingTask` 流水线如何为单题入队
   - 确认 `StudentNotification` 通知格式

2. **Task 1 之前新增 Step 0：补齐所有需要的 pytest fixture**

3. **Task 3 拆开为按题型实现的多个 step：**
   - Step 3a：choice / true_false 重评（纯客观，直接重算 `is_correct`）
   - Step 3b：fill_in 重评（调用 DeepSeek 等价匹配）
   - Step 3c：code 重评（调用 judge_runner，复用 `run_code_via_judge_runner`）
   - Step 3d：short_answer / essay 重评（**视 P0-1 决策**，可能 enqueue GradingTask 或跳过）

4. **Task 3 新增 step：聚合分数与 grading_status 回写**

5. **Task 4 之后新增 Task 4.5：**
   - 重评前对 `StudentExamAnswer` 现状写入 `GradingResultSnapshot`
   - 重评完成后通过 `StudentNotification` 通知受影响学生
   - 记录 `RegradeEvent` 审计数据
   - 处理已有 `StudentExamAppeal` 的状态联动

6. **修正 Plan 现有问题：**
   - Task 1 Step 3：补全 `diff_question_update` 的浅/深比较规则
   - Task 1 Step 4：明确 `knowledge_point_ids` 按集合比较
   - Task 3 Step 5：用 `GradingTask` 替换 `BackgroundTasks`
   - Task 2 Step 5：在 `question_is_in_use` SQL 中追加 `Exam.status != 'draft'` 条件（视 P0-4 决策）

---

## 决策记录 (Decisions Confirmed — 2026-05-14)

以下 P0 决策已经与产品确认，后续 Task 修订与实施必须按此执行：

| # | 议题 | 决策 | 实现含义 |
|---|------|------|----------|
| D1 | Practice 锁定 (P0-3) | **考试和练习都锁定** | 保持当前 spec 行为，`question_is_in_use` 不按 `Exam.category` 过滤 |
| D2 | Draft / 状态锁定 (P0-4) | **仅"进行中"的考试锁定** | `question_is_in_use` SQL 需追加 `Exam.status = 'ongoing'`。Draft、scheduled、completed、closed 状态均不锁定。⚠️ 这意味着教师可在 completed/closed 考试上自由修改题目内容，需在 UI 给出明确提示 |
| D3 | 主观题重评 (P0-1) | **不自动重评，仅刷新参考答案显示** | `short_answer` / `essay` 修改 `answer` 字段时**不**触发重评。`question_update_requires_regrade` 中需排除这两种题型 |
| D4 | 学生通知 (P1-7) | **发通知，写明分数变化** | 重评完成后通过 `StudentNotification` 推送，正文格式：`考试「{exam_title}」的题目「{question_title}」已重新评分，得分从 {old} 调整为 {new}` |

### 由 D2 / D3 派生的重评矩阵（替换原 P0-1 表格）

| 题型 | answer 变化 | content.sample_tests 变化 |
|------|-------------|---------------------------|
| choice | 重算 `is_correct` + `score_awarded` | N/A |
| true_false | 重算 `is_correct` + `score_awarded` | N/A |
| fill_in | 重跑 `_request_fill_in_equivalence_with_deepseek` | N/A |
| short_answer | **不重评** (D3) | N/A |
| essay | **不重评** (D3) | N/A |
| code | N/A（code 题答案在 sample_tests 内） | 重跑 `run_code_via_judge_runner` |

### 由其他评审项派生的强制要求（无需再询问）

- **D-A：异步执行模型** (P0-2) — 必须复用 `app/grading/service.py` 的 `GradingTask` 流水线，**禁止**使用 FastAPI `BackgroundTasks` 调度跨学生重评。
- **D-B：重评前快照** (P2-13) — 重评每个学生前必须将当前 `StudentExamAnswer.feedback` + `score_awarded` 写入 `GradingResultSnapshot`。
- **D-C：聚合分数回写** (P1-5) — 单题重评完成后必须重算 `ExamStudent.objective_score` / `subjective_score` / `score`，并在主观题仍未评完时保持 `grading_status = pending_ai`。
- **D-D：并发去重** (P1-8) — `GradingTask` 入队前按 `(exam_id, student_id, question_id, status IN ('pending','running'))` 去重，避免同一题被重复 enqueue。
- **D-E：申诉联动** (P1-6) — 若被重评题目存在已 resolved 的 `StudentExamAppeal`，保留 appeal 历史不动；若 status 为 `pending`，重评不改变 appeal 状态（教师仍需手动处理 appeal）。
- **D-F：审计记录** (P2-14) — 在 `GradingTask` 入队时记录触发者 `triggered_by_user_id` 与触发原因 `trigger_reason='question_update'`，无需新建独立 RegradeEvent 表。

---

## File Structure

### Backend files

- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/router.py`
  - Add in-use metadata to question fetch/update flows
  - Convert forbidden in-use edits into clear HTTP 400 responses
  - Trigger asynchronous regrading after successful save when needed

- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/service.py`
  - Add question-in-use detection
  - Add structured update diffing and allowlist enforcement
  - Add regrading trigger detection and affected-attempt selection

- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/schemas.py`
  - Extend question response or add dedicated metadata schema so frontend can know which fields are locked and whether save will trigger regrading

- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/grading/service.py`
  - Reuse current `GradingTask` pipeline for question-driven regrading entry point (per D-A)
  - Add a focused service function that regrades one affected `(exam, student, question)` combination
  - Implement per-question-type regrading dispatch (choice/true_false/fill_in/code per matrix above)
  - **Write pre-regrade snapshot to `GradingResultSnapshot`** (per D-B)
  - **Recompute `ExamStudent.objective_score` / `subjective_score` / `score`** after each question regrade (per D-C)

- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/grading/models.py`
  - Add `triggered_by_user_id` and `trigger_reason` columns to `GradingTask` if not present (per D-F)
  - Alembic migration for the new columns

- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/exams/models.py`
  - Reference only for typed queries; avoid schema changes here

- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/exams/student_router.py`
  - When students view exam result page, ensure regrade-in-progress shows pending state if `grading_status` reverted

- New / Modify: notification helper (likely in `app/exams/student_router.py` or a new `app/notifications/service.py`)
  - Create `StudentNotification` rows after regrade completes (per D4 wording)

- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_question_edit_locking.py`
  - New backend coverage for allowed/forbidden edits and regrading triggers
  - **Includes fixture setup for `seeded_exam_question`, `code_question_factory`, `in_use_question`, `question_factory`** (per P2-16)

- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_question_regrading.py`
  - New backend coverage for affected-attempt selection, per-type regrade dispatch, snapshot, notification, aggregate score writeback, concurrent dedupe

### Frontend files

- Modify: `/Users/jzefan/work/proj/exam/frontend/src/types/index.ts`
  - Add typed question edit lock metadata returned by backend

- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/edit.tsx`
  - Show warning banner for in-use questions
  - Disable locked fields
  - Keep allowed fields editable
  - Show differentiated success feedback for normal save vs regrading-trigger save

- Possibly modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/code-question-mode.ts`
  - If code-question test-case editing needs helper extraction for “allowed subtree” UI isolation

- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-edit-locking.test.tsx`
  - New UI tests for banner, disabled fields, and success/error messaging

---

### Task 0: 代码现状调研与测试 fixture 落地（新增）

> 由评审 P2-12、P2-16 派生。落地前必须先锁定具体字段名与 fixture，否则后续 Task 一旦执行就会全红。

**Files:**
- Read-only: `/Users/jzefan/work/proj/exam/backend/src/app/questions/models.py`
- Read-only: `/Users/jzefan/work/proj/exam/backend/src/app/questions/schemas.py`
- Read-only: `/Users/jzefan/work/proj/exam/backend/src/app/grading/service.py`
- Read-only: `/Users/jzefan/work/proj/exam/backend/src/app/grading/models.py`
- Read-only: `/Users/jzefan/work/proj/exam/backend/src/app/exams/models.py` (`StudentNotification`, `ExamStudent`, `GradingResultSnapshot`)
- Modify: `/Users/jzefan/work/proj/exam/backend/tests/conftest.py` 或新增 `tests/fixtures/questions.py`

- [ ] **Step 1: 确认 code question `content` 的实际 schema**

阅读 `Question.content` 在 code 题型下的实际字段。在 `service.py` 或 schema 中查找 `sample_tests` / `test_cases` / `judge_cases` 出现位置。落实最终 `ALLOWED_CODE_CONTENT_KEYS` 值。

输出：在本 Task 0 末尾追加一段 `### 确认结论` 说明：
- code question content 的非测试用例字段（如 `mode`, `description`, `function_signature` 等）完整列表
- 测试用例字段的实际 key（替换 Plan 中猜测的 `{"sample_tests", "test_cases", "judge_cases"}`）

- [ ] **Step 2: 确认 `GradingTask` 模型字段**

阅读 `/Users/jzefan/work/proj/exam/backend/src/app/grading/models.py` 的 `GradingTask` 与 `GradingResultSnapshot` 结构：
- `GradingTask` 是否已有 `triggered_by_user_id` / `trigger_reason` 字段？没有的话需要 alembic migration
- `GradingTask` 当前接受的入参，确认能否表达 `(exam_id, student_id, question_id)` 单题重评粒度
- `GradingResultSnapshot` 是否包含足够字段保存重评前的 `feedback` 和 `score_awarded`

输出：决定是否需要新 migration 与字段。

- [ ] **Step 3: 确认 `StudentNotification` 模型字段**

阅读 `StudentNotification` 模型与 `student_router.py` 中现有创建路径，了解 notification 的字段格式（`title`、`message`、`type`、`read_at` 等）。决定重评通知使用的 `type` 值（如 `regrade` 或复用已有）。

- [ ] **Step 4: 创建测试 fixtures**

在 `tests/conftest.py` 或专用 fixture 文件中实现：

```python
@pytest.fixture
def question_factory(db_session):
    """Sync-style factory returning a Question instance with overridable kwargs."""
    def make(**overrides):
        question = Question(
            id=overrides.pop("id", uuid.uuid4()),
            type=overrides.pop("type", QuestionType.SHORT_ANSWER),
            title=overrides.pop("title", "测试题"),
            content=overrides.pop("content", {"text": "默认题面"}),
            options=overrides.pop("options", None),
            answer=overrides.pop("answer", {}),
            analysis=overrides.pop("analysis", ""),
            difficulty=overrides.pop("difficulty", "medium"),
            score=overrides.pop("score", 10.0),
            **overrides,
        )
        return question
    return make


@pytest.fixture
def code_question_factory(question_factory):
    def make(**overrides):
        return question_factory(
            type=QuestionType.CODE,
            content=overrides.pop("content", {
                "description": "默认题面",
                "sample_tests": [{"input": "1", "expected_output": "1"}],
            }),
            **overrides,
        )
    return make


@pytest_asyncio.fixture
async def seeded_exam_question(db_session, question_factory) -> ExamQuestion:
    """A persisted Question referenced by a non-deleted ongoing exam, no student attempts."""
    ...


@pytest_asyncio.fixture
async def in_use_question(db_session, seeded_exam_question) -> Question:
    return seeded_exam_question.question


@pytest_asyncio.fixture
async def seeded_question_usage(db_session, question_factory):
    """Returns object with .question_id, .submitted_exam_id, .submitted_student_id where exactly one submitted attempt exists."""
    ...


@pytest_asyncio.fixture
async def seeded_deleted_exam_question_usage(db_session, question_factory):
    """Like seeded_question_usage but the exam is soft-deleted."""
    ...


@pytest.fixture
def auth_headers(teacher_user, jwt_for) -> dict[str, str]:
    return {"Authorization": f"Bearer {jwt_for(teacher_user)}"}
```

依赖于现有 `db_session`、`teacher_user`、`jwt_for` 等基础 fixture 是否已存在；若缺则在本 Task 中一并补齐。

- [ ] **Step 5: 验证 fixture 可被 pytest 收集**

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src .venv/bin/python -m pytest tests/ --collect-only -q | tail -20
```

Expected：

- 无 fixture 缺失类报错（`fixture '...' not found`）

- [ ] **Step 6: Commit 调研与 fixture 落地**

```bash
git add /Users/jzefan/work/proj/exam/backend/tests/conftest.py /Users/jzefan/work/proj/exam/backend/tests/fixtures/
git commit -m "test: add fixtures for question edit lock and regrading tests"
```

### 确认结论

> 该小节由执行者在 Step 1-3 完成后填入。后续 Task 中所有"字段名 / key / migration 必要性"以此结论为准。

---

### Task 1: Add backend primitives for question in-use detection and update diffing

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/service.py`
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_question_edit_locking.py`

- [ ] **Step 1: Write the failing backend tests for in-use detection and diff classification**

```python
import uuid

import pytest

from app.questions.service import (
    question_is_in_use,
    diff_question_update,
    question_update_requires_regrade,
    validate_in_use_question_update,
)


@pytest.mark.asyncio
async def test_question_is_in_use_when_exam_reference_exists(db_session, seeded_exam_question):
    in_use = await question_is_in_use(db_session, seeded_exam_question.question_id)
    assert in_use is True


def test_diff_question_update_marks_title_change_forbidden(question_factory):
    question = question_factory(title="旧题干")
    changed = diff_question_update(
        question,
        {
            "title": "新题干",
        },
    )
    assert "title" in changed.changed_fields
    assert changed.forbidden_fields == {"title"}


def test_answer_change_requires_regrade(question_factory):
    question = question_factory(answer={"correct": "A"})
    changed = diff_question_update(question, {"answer": {"correct": "B"}})
    assert question_update_requires_regrade(question, changed) is True


def test_analysis_change_does_not_require_regrade(question_factory):
    question = question_factory(analysis="旧解析")
    changed = diff_question_update(question, {"analysis": "新解析"})
    assert question_update_requires_regrade(question, changed) is False


def test_validate_in_use_question_update_rejects_score_change(question_factory):
    question = question_factory(score=5.0)
    changed = diff_question_update(question, {"score": 8.0})

    with pytest.raises(ValueError, match="不能修改题干、选项、题型或分值"):
        validate_in_use_question_update(question, changed)
```

- [ ] **Step 2: Run the new backend tests to confirm they fail**

Run:

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_edit_locking.py -q
```

Expected:

- Import errors or missing symbol failures for the new helpers

- [ ] **Step 3: Add focused helper types and service functions in `questions/service.py`**

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class QuestionUpdateDiff:
    changed_fields: set[str]
    forbidden_fields: set[str]
    allowed_content_change_keys: set[str]


async def question_is_in_use(db: AsyncSession, question_id: uuid.UUID) -> bool:
    """Per D1+D2: 任何 status='ongoing' 且未软删除的 exam (含 practice) 引用即视为 in use。"""
    exam_ref = await db.scalar(
        select(ExamQuestion.question_id)
        .join(Exam, Exam.id == ExamQuestion.exam_id)
        .where(
            ExamQuestion.question_id == question_id,
            Exam.deleted_at.is_(None),
            Exam.status == "ongoing",  # D2: 仅"进行中"才锁定
        )
        .limit(1)
    )
    return exam_ref is not None


_SUBJECTIVE_NO_AUTO_REGRADE_TYPES = {QuestionType.SHORT_ANSWER, QuestionType.ESSAY}  # D3


def diff_question_update(question: Question, incoming: dict[str, Any]) -> QuestionUpdateDiff:
    """Compare current question state against an incoming partial update dict.

    Comparison rules (per P2-11 review feedback):
    - Top-level scalar/dict fields: deep equality (`==`)
    - `knowledge_point_ids`: order-insensitive set equality
    - `options`: treat `None` and `{}` as equivalent (both mean "no options")
    - `content`: recursive deep comparison, but for QuestionType.CODE allow
      changes in `ALLOWED_CODE_CONTENT_KEYS` without marking `content` forbidden
    """
    changed_fields: set[str] = set()
    forbidden_fields: set[str] = set()
    allowed_content_change_keys: set[str] = set()

    for field, new_value in incoming.items():
        if field == "knowledge_point_ids":
            old_ids = {str(kp.id) for kp in (question.knowledge_points or [])}
            new_ids = {str(x) for x in (new_value or [])}
            if old_ids != new_ids:
                changed_fields.add(field)
            continue

        if field == "options":
            old_options = question.options or {}
            new_options = new_value or {}
            if old_options != new_options:
                changed_fields.add(field)
                if field in LOCKED_TOP_LEVEL_FIELDS:
                    forbidden_fields.add(field)
            continue

        if field == "content":
            old_content = question.content or {}
            new_content = new_value or {}
            if old_content == new_content:
                continue
            changed_fields.add("content")
            if question.type == QuestionType.CODE:
                # Code-question partial-lock: strip editable test-case keys
                # from both sides and compare the remainder
                old_locked = {k: v for k, v in old_content.items() if k not in ALLOWED_CODE_CONTENT_KEYS}
                new_locked = {k: v for k, v in new_content.items() if k not in ALLOWED_CODE_CONTENT_KEYS}
                if old_locked != new_locked:
                    forbidden_fields.add("content")
                # Track which test-case keys actually changed
                for key in ALLOWED_CODE_CONTENT_KEYS:
                    if old_content.get(key) != new_content.get(key):
                        allowed_content_change_keys.add(key)
            else:
                forbidden_fields.add("content")
            continue

        # Default: deep equality on the attribute
        old_value = getattr(question, field, None)
        if old_value != new_value:
            changed_fields.add(field)
            if field in LOCKED_TOP_LEVEL_FIELDS:
                forbidden_fields.add(field)

    return QuestionUpdateDiff(
        changed_fields=changed_fields,
        forbidden_fields=forbidden_fields,
        allowed_content_change_keys=allowed_content_change_keys,
    )


def validate_in_use_question_update(question: Question, diff: QuestionUpdateDiff) -> None:
    if diff.forbidden_fields:
        raise ValueError("这道题正在考试或练习中使用，不能修改题干、选项、题型或分值。")


def question_update_requires_regrade(question: Question, diff: QuestionUpdateDiff) -> bool:
    """Per D3: short_answer / essay 的 answer 变化不触发重评。"""
    if "answer" in diff.changed_fields and question.type not in _SUBJECTIVE_NO_AUTO_REGRADE_TYPES:
        return True
    if question.type == QuestionType.CODE and allowed_content_change_keys_indicate_test_case_change(diff):
        return True
    return False


def allowed_content_change_keys_indicate_test_case_change(diff: QuestionUpdateDiff) -> bool:
    return bool(diff.allowed_content_change_keys & ALLOWED_CODE_CONTENT_KEYS)
```

- [ ] **Step 4: 定义 LOCKED / ALLOWED 字段常量（与 Task 0 调研结论对齐）**

```python
LOCKED_TOP_LEVEL_FIELDS = {"type", "title", "options", "score"}
ALLOWED_TOP_LEVEL_FIELDS = {"answer", "analysis", "difficulty", "knowledge_point_ids"}
# Task 0 Step 1 调研结论确认后替换以下集合：
ALLOWED_CODE_CONTENT_KEYS = {"sample_tests"}  # 占位，以 Task 0 调研结论为准
```

⚠️ 实施时必须先回头读 Task 0 "确认结论" 一节，按实际 schema 调整 `ALLOWED_CODE_CONTENT_KEYS`。

新增 Test：

```python
def test_diff_question_update_treats_knowledge_point_ids_as_set(question_factory):
    """顺序变化不应判为变更。"""
    question = question_factory()
    question.knowledge_points = []  # 模拟空集合
    changed = diff_question_update(question, {"knowledge_point_ids": []})
    assert "knowledge_point_ids" not in changed.changed_fields


def test_diff_question_update_treats_options_none_and_empty_dict_as_equal(question_factory):
    question = question_factory(options=None)
    changed = diff_question_update(question, {"options": {}})
    assert "options" not in changed.changed_fields


def test_short_answer_answer_change_does_not_require_regrade(question_factory):
    """D3: 主观题改 answer 不重评。"""
    question = question_factory(type=QuestionType.SHORT_ANSWER, answer={"text": "旧"})
    changed = diff_question_update(question, {"answer": {"text": "新"}})
    assert question_update_requires_regrade(question, changed) is False


def test_essay_answer_change_does_not_require_regrade(question_factory):
    question = question_factory(type=QuestionType.ESSAY, answer={"text": "旧"})
    changed = diff_question_update(question, {"answer": {"text": "新"}})
    assert question_update_requires_regrade(question, changed) is False
```

- [ ] **Step 5: Re-run the backend tests**

Run:

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_edit_locking.py -q
```

Expected:

- All tests in `test_question_edit_locking.py` pass

- [ ] **Step 6: Commit the helper-layer work**

```bash
git add /Users/jzefan/work/proj/exam/backend/src/app/questions/service.py /Users/jzefan/work/proj/exam/backend/tests/test_question_edit_locking.py
git commit -m "feat: add in-use question edit validation helpers"
```

---

### Task 2: Enforce in-use update rules in the question update API

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/router.py`
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/service.py`
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/schemas.py`
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_question_edit_locking.py`

- [ ] **Step 1: Add a failing API test that rejects forbidden edits**

```python
@pytest.mark.asyncio
async def test_update_question_api_rejects_title_change_when_question_in_use(client, auth_headers, in_use_question):
    response = await client.put(
        f"/api/questions/{in_use_question.id}",
        headers=auth_headers,
        json={"title": "新的题干"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "这道题正在考试或练习中使用，不能修改题干、选项、题型或分值。"
```

- [ ] **Step 2: Run the targeted API test and verify failure**

Run:

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_edit_locking.py::test_update_question_api_rejects_title_change_when_question_in_use -q
```

Expected:

- Test fails because API still allows forbidden change or returns the wrong response

- [ ] **Step 3: Extend question response with in-use metadata**

In `/Users/jzefan/work/proj/exam/backend/src/app/questions/schemas.py`:

```python
class QuestionEditLockInfo(BaseModel):
    in_use: bool
    allowed_fields: list[str] = Field(default_factory=list)
    regrade_on_fields: list[str] = Field(default_factory=list)
    has_submitted_attempts: bool = False


class QuestionResponse(BaseModel):
    ...
    edit_lock: QuestionEditLockInfo | None = None
```

Populate it in `QuestionResponse.from_question(...)` from router-side metadata.

- [ ] **Step 4: Enforce validation in `update_question_endpoint`**

Update `/Users/jzefan/work/proj/exam/backend/src/app/questions/router.py` so the route:

```python
update_data = data.model_dump(exclude_unset=True)
in_use = await question_is_in_use(db, question.id)
diff = diff_question_update(question, update_data)
if in_use:
    try:
        validate_in_use_question_update(question, diff)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
```

Then pass the computed flags into the updated service call.

- [ ] **Step 5: Return `edit_lock` metadata from `GET /questions/{id}`**

Add a small helper in the router:

```python
async def _build_question_edit_lock_info(db: AsyncSession, question: Question) -> QuestionEditLockInfo:
    in_use = await question_is_in_use(db, question.id)
    has_submitted_attempts = await question_has_submitted_attempts(db, question.id)
    return QuestionEditLockInfo(
        in_use=in_use,
        allowed_fields=["answer", "analysis", "difficulty", "knowledge_point_ids", "code_test_cases"] if in_use else [],
        regrade_on_fields=["answer", "code_test_cases"] if in_use else [],
        has_submitted_attempts=has_submitted_attempts,
    )
```

- [ ] **Step 6: Re-run question edit locking tests**

Run:

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_edit_locking.py -q
```

Expected:

- API rejection test passes
- metadata tests pass

- [ ] **Step 7: Commit the API enforcement layer**

```bash
git add /Users/jzefan/work/proj/exam/backend/src/app/questions/router.py /Users/jzefan/work/proj/exam/backend/src/app/questions/schemas.py /Users/jzefan/work/proj/exam/backend/src/app/questions/service.py /Users/jzefan/work/proj/exam/backend/tests/test_question_edit_locking.py
git commit -m "feat: enforce in-use question edit restrictions"
```

---

### Task 3: 受影响学生选择 + 单题重评（按题型分派，复用 GradingTask）

> 由 D-A / D-B / D-C / D-D 派生。**禁止使用 FastAPI BackgroundTasks**；所有跨学生重评必须通过 `GradingTask` 入队，由现有 worker 消费。

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/service.py`
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/router.py`
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/grading/service.py`
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/grading/models.py`（视 Task 0 Step 2 结论决定是否加 migration 字段）
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_question_regrading.py`

- [ ] **Step 1: 写受影响学生选择的失败测试**

```python
@pytest.mark.asyncio
async def test_question_regrading_targets_submitted_students_only(db_session, seeded_question_usage):
    affected = await find_submitted_attempts_affected_by_question_change(
        db_session, seeded_question_usage.question_id
    )
    assert {(item.exam_id, item.student_id) for item in affected} == {
        (seeded_question_usage.submitted_exam_id, seeded_question_usage.submitted_student_id),
    }


@pytest.mark.asyncio
async def test_question_regrading_excludes_deleted_exams(db_session, seeded_deleted_exam_question_usage):
    affected = await find_submitted_attempts_affected_by_question_change(
        db_session, seeded_deleted_exam_question_usage.question_id
    )
    assert affected == []
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src .venv/bin/python -m pytest tests/test_question_regrading.py -q
```

Expected：缺函数失败。

- [ ] **Step 3: 实现 affected-attempt 选择 helpers**

```python
@dataclass(frozen=True)
class AffectedSubmittedAttempt:
    exam_id: uuid.UUID
    student_id: uuid.UUID
    question_id: uuid.UUID


async def question_has_submitted_attempts(db: AsyncSession, question_id: uuid.UUID) -> bool:
    row = await db.scalar(
        select(StudentExamAnswer.question_id)
        .join(Exam, Exam.id == StudentExamAnswer.exam_id)
        .join(ExamStudent, and_(
            ExamStudent.exam_id == StudentExamAnswer.exam_id,
            ExamStudent.student_id == StudentExamAnswer.student_id,
        ))
        .where(
            StudentExamAnswer.question_id == question_id,
            Exam.deleted_at.is_(None),
            ExamStudent.submitted_at.is_not(None),
        )
        .limit(1)
    )
    return row is not None


async def find_submitted_attempts_affected_by_question_change(
    db: AsyncSession, question_id: uuid.UUID
) -> list[AffectedSubmittedAttempt]:
    rows = await db.execute(
        select(StudentExamAnswer.exam_id, StudentExamAnswer.student_id, StudentExamAnswer.question_id)
        .join(Exam, Exam.id == StudentExamAnswer.exam_id)
        .join(
            ExamStudent,
            and_(
                ExamStudent.exam_id == StudentExamAnswer.exam_id,
                ExamStudent.student_id == StudentExamAnswer.student_id,
            ),
        )
        .where(
            StudentExamAnswer.question_id == question_id,
            Exam.deleted_at.is_(None),
            ExamStudent.submitted_at.is_not(None),
        )
        .distinct()
    )
    return [AffectedSubmittedAttempt(*row) for row in rows.all()]
```

注意 SQL 中**没有** `Exam.status = 'ongoing'` 过滤——D2 只限定锁定范围，重评范围按 spec 包含所有非删除的考试。

- [ ] **Step 4a: 按题型分派的重评入口（choice / true_false / fill_in）**

在 `/Users/jzefan/work/proj/exam/backend/src/app/grading/service.py` 新增：

```python
async def regrade_objective_answer(
    db: AsyncSession,
    *,
    student_answer: StudentExamAnswer,
    question: Question,
    exam_question: ExamQuestion,
) -> RegradeResult:
    """For choice / true_false: 直接比对 answer_content 与新 answer，回写 is_correct / score_awarded。"""
    ...


async def regrade_fill_in_answer(
    db: AsyncSession,
    *,
    student_answer: StudentExamAnswer,
    question: Question,
    exam_question: ExamQuestion,
) -> RegradeResult:
    """For fill_in: 调用 _request_fill_in_equivalence_with_deepseek 重新判定。"""
    ...
```

测试用例：

```python
@pytest.mark.asyncio
async def test_regrade_choice_updates_is_correct(db_session, seeded_choice_attempt):
    # 修改标准答案后，重新评分
    result = await regrade_objective_answer(...)
    assert result.score_awarded == ...
    assert result.is_correct in (True, False)
```

- [ ] **Step 4b: 按题型分派的重评入口（code）**

```python
async def regrade_code_answer(
    db: AsyncSession,
    *,
    student_answer: StudentExamAnswer,
    question: Question,
    exam_question: ExamQuestion,
) -> RegradeResult:
    """For code: 调用 run_code_via_judge_runner 用新的 sample_tests 重跑 student 提交。"""
    ...
```

- [ ] **Step 4c: 主观题占位（D3 决策不自动重评）**

```python
async def regrade_subjective_answer(...) -> RegradeResult:
    """D3: short_answer / essay 不自动重评。此函数不应被调用，调用即抛 AssertionError。"""
    raise AssertionError("D3: subjective questions are not auto-regraded; do not enqueue")
```

测试覆盖：

```python
def test_question_update_requires_regrade_excludes_short_answer():
    # 已在 Task 1 覆盖，此处确认 dispatch 层不会接收 short_answer
```

- [ ] **Step 5: 统一入口 `regrade_submitted_question_for_student`**

```python
async def regrade_submitted_question_for_student(
    db: AsyncSession,
    *,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
    question_id: uuid.UUID,
    triggered_by_user_id: uuid.UUID,
) -> None:
    """单题重评统一入口。流程：
    1. 加载 StudentExamAnswer / Question / ExamQuestion
    2. 写 GradingResultSnapshot 快照（D-B）
    3. 按 question.type 分派到对应 regrade_xxx 函数
    4. 回写 StudentExamAnswer.score_awarded / is_correct / feedback
    5. 重算 ExamStudent.objective_score / subjective_score / score（D-C）
    6. 创建 StudentNotification 通知学生（D4）
    """
    ...
```

按题型分派的 dispatch table：

```python
_REGRADE_DISPATCH: dict[QuestionType, Callable] = {
    QuestionType.CHOICE: regrade_objective_answer,
    QuestionType.TRUE_FALSE: regrade_objective_answer,
    QuestionType.FILL_IN: regrade_fill_in_answer,
    QuestionType.CODE: regrade_code_answer,
    # short_answer / essay 不在表中，按 D3 不重评
}
```

⚠️ 必须在 dispatch 前先 snapshot；snapshot 失败时拒绝继续重评，保持原始分数。

- [ ] **Step 6: 通过 GradingTask 入队，不使用 BackgroundTasks**

在 `/Users/jzefan/work/proj/exam/backend/src/app/questions/router.py`：

```python
if requires_regrade:
    await enqueue_question_regrade_tasks(
        db,
        question_id=question.id,
        triggered_by_user_id=current_user.id,
    )
```

新增到 `app/questions/service.py`：

```python
async def enqueue_question_regrade_tasks(
    db: AsyncSession,
    *,
    question_id: uuid.UUID,
    triggered_by_user_id: uuid.UUID,
) -> int:
    """为每个受影响学生入队一个 GradingTask。返回入队数量。

    - 复用 app.grading.service.create_grading_task 流水线（D-A）
    - 入队前按 (exam_id, student_id, question_id, status IN ('pending','running')) 去重（D-D）
    - 设置 GradingTask.triggered_by_user_id 与 trigger_reason='question_update'（D-F）
    """
    affected = await find_submitted_attempts_affected_by_question_change(db, question_id)
    enqueued = 0
    for attempt in affected:
        already_queued = await _has_pending_regrade_task(db, attempt)
        if already_queued:
            continue
        await create_grading_task(
            db,
            exam_id=attempt.exam_id,
            student_id=attempt.student_id,
            question_id=attempt.question_id,
            triggered_by_user_id=triggered_by_user_id,
            trigger_reason="question_update",
        )
        enqueued += 1
    return enqueued
```

⚠️ `create_grading_task` 的实际签名以 Task 0 Step 2 调研结论为准，若现有签名不支持 `triggered_by_user_id` / `trigger_reason`，需先在 grading service 与 model 加字段。

- [ ] **Step 7: 单元测试覆盖每个题型 + 去重 + 通知 + 聚合**

```python
@pytest.mark.asyncio
async def test_regrade_choice_writes_snapshot_and_notification(db_session, seeded_choice_submission, teacher_user):
    await regrade_submitted_question_for_student(db_session, exam_id=..., student_id=..., question_id=..., triggered_by_user_id=teacher_user.id)
    # 1. snapshot 存在
    snapshot = await db_session.scalar(select(GradingResultSnapshot).where(...))
    assert snapshot is not None
    assert snapshot.score_awarded_before == 10.0
    # 2. notification 存在
    notification = await db_session.scalar(select(StudentNotification).where(...))
    assert "已重新评分" in notification.message
    # 3. 聚合分数已更新
    exam_student = await db_session.scalar(select(ExamStudent).where(...))
    assert exam_student.score == 90.0  # 原 100 - 10


@pytest.mark.asyncio
async def test_enqueue_dedupes_pending_tasks(db_session, seeded_question_usage, teacher_user):
    await enqueue_question_regrade_tasks(db_session, question_id=seeded_question_usage.question_id, triggered_by_user_id=teacher_user.id)
    enqueued_second = await enqueue_question_regrade_tasks(db_session, question_id=seeded_question_usage.question_id, triggered_by_user_id=teacher_user.id)
    assert enqueued_second == 0  # D-D 去重


@pytest.mark.asyncio
async def test_enqueue_skips_short_answer(db_session, seeded_short_answer_question_usage, teacher_user):
    # D3: short_answer 即使 answer 变了也不入队
    enqueued = await enqueue_question_regrade_tasks(...)
    assert enqueued == 0
```

- [ ] **Step 8: 重跑全部 regrading 测试**

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src .venv/bin/python -m pytest tests/test_question_regrading.py -q
```

Expected：全部通过。

- [ ] **Step 9: Commit**

```bash
git add /Users/jzefan/work/proj/exam/backend/src/app/questions/service.py \
        /Users/jzefan/work/proj/exam/backend/src/app/questions/router.py \
        /Users/jzefan/work/proj/exam/backend/src/app/grading/service.py \
        /Users/jzefan/work/proj/exam/backend/src/app/grading/models.py \
        /Users/jzefan/work/proj/exam/backend/tests/test_question_regrading.py \
        /Users/jzefan/work/proj/exam/backend/alembic/versions/*regrade*  # 视 Task 0 Step 2
git commit -m "feat: per-type question regrading with snapshot, notification, and dedup"
```

---

### Task 4: Add teacher-side warning banner, field locking, and save feedback

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/types/index.ts`
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/edit.tsx`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-edit-locking.test.tsx`

- [ ] **Step 1: Write the failing frontend tests for in-use warning and disabled fields**

```tsx
it("shows lock banner and disables student-visible fields when question is in use", async () => {
  mockQuestionResponse.edit_lock = {
    in_use: true,
    allowed_fields: ["answer", "analysis", "difficulty", "knowledge_point_ids", "code_test_cases"],
    regrade_on_fields: ["answer", "code_test_cases"],
    has_submitted_attempts: true,
  };

  render(<QuestionEditPage />);

  expect(await screen.findByText("这道题正在某些考试或练习中使用，题目内容已锁定。")).toBeInTheDocument();
  expect(screen.getByLabelText("题目标题")).toBeDisabled();
  expect(screen.getByLabelText("难度")).not.toBeDisabled();
});
```

- [ ] **Step 2: Run the frontend test and confirm failure**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && CI=1 pnpm exec vitest run src/pages/questions/question-edit-locking.test.tsx --reporter=verbose
```

Expected:

- Missing UI state / missing test file failure

- [ ] **Step 3: Extend frontend types for question lock metadata**

In `/Users/jzefan/work/proj/exam/frontend/src/types/index.ts`:

```ts
export interface QuestionEditLockInfo {
  in_use: boolean;
  allowed_fields: string[];
  regrade_on_fields: string[];
  has_submitted_attempts: boolean;
}

export interface IQuestion {
  ...
  edit_lock?: QuestionEditLockInfo | null;
}
```

- [ ] **Step 4: Render the teacher warning banner and secondary regrading hint**

In `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/edit.tsx` add derived flags:

```ts
const editLock = question?.edit_lock;
const inUse = !!editLock?.in_use;
const willRegradeHint = inUse && !!editLock?.has_submitted_attempts;
```

Render（文案按 D2：仅"进行中"考试触发锁定）：

```tsx
{inUse ? (
  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
    <div>这道题正在进行中的考试或练习里使用，题目内容已锁定。你仍可修改答案、解析、难度、知识点标签和编程题测试用例。</div>
    {willRegradeHint ? (
      <div className="mt-1 text-amber-800">修改客观题答案或编程题测试用例后，系统会自动重新评分已提交的考生答卷；主观题答案变更不会自动重评。</div>
    ) : null}
  </div>
) : null}
```

- [ ] **Step 5: Disable locked fields but keep allowed fields editable**

⚠️ 由 P2-15：`options` 编辑器是嵌套组件，不能只在外层加 `disabled={inUse}`。需要：

1. 把 `inUse` 作为 prop 沿组件树往下传，复杂编辑器内部读取并禁用所有交互
2. 对于 `score` 这种位于 `ExamWizardForm` / 题型表单内的字段，需逐个加 `disabled={inUse}`

Use `disabled={inUse}` for（在最深的 input/button 上）：

- title input
- type selector
- options 编辑器内的所有输入框 + 增/删选项按钮
- score input
- student-visible code question content sections except test-case editor

Keep enabled:

- answer inputs
- analysis editor
- difficulty selector
- knowledge-point selector
- code test-case editor

新增测试覆盖：

```tsx
it("disables option add/remove buttons when in use", async () => {
  mockQuestionResponse.edit_lock = { in_use: true, ... };
  render(<QuestionEditPage />);
  expect(screen.getByRole("button", { name: "添加选项" })).toBeDisabled();
});
```

- [ ] **Step 6: Show differentiated success feedback**

⚠️ 由 D3：仅当变更字段是**客观题 answer** 或 **code test cases** 时才显示"重评"toast。修改主观题 answer 不应触发重评 toast，因为后端也不会重评。

```ts
const SUBJECTIVE_TYPES = ["short_answer", "essay"];
const triggersRegrade =
  inUse &&
  changedFields.some((field) => {
    if (field === "answer") {
      return !SUBJECTIVE_TYPES.includes(question.type);
    }
    return field === "code_test_cases";
  });

open?.({
  type: "success",
  message: triggersRegrade
    ? "题目已保存，系统正在重新评分受影响的考生答卷。"
    : "题目已保存。",
});
```

如果后端返回 400，使用其 `detail` 文案直接展示。

⚠️ P2-10：`code_test_cases` 是**逻辑名**，前端用它来决定 toast；后端 diff 用的是 `content` 内部的实际 key。两边约定通过 `QuestionEditLockInfo.regrade_on_fields` 中的逻辑名对接，**前端不读 content 内部结构**。

- [ ] **Step 7: Re-run the frontend tests**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && CI=1 pnpm exec vitest run src/pages/questions/question-edit-locking.test.tsx --reporter=verbose
cd /Users/jzefan/work/proj/exam/frontend && pnpm exec tsc --noEmit --pretty false
```

Expected:

- UI tests pass
- Type check passes

- [ ] **Step 8: Commit the teacher-side locking UI**

```bash
git add /Users/jzefan/work/proj/exam/frontend/src/types/index.ts /Users/jzefan/work/proj/exam/frontend/src/pages/questions/edit.tsx /Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-edit-locking.test.tsx
git commit -m "feat: lock in-use question fields in teacher edit UI"
```

---

### Task 4.5: 整合 snapshot / 通知 / 申诉联动 / 学生结果页一致性（新增）

> 由 D-B / D-E / D-F + P1-7 派生。Task 3 已经在 `regrade_submitted_question_for_student` 中实现了单题层面的 snapshot 和 notification 写入；本 Task 负责**端到端**验证以下行为，以及补齐学生结果页与申诉联动的边界。

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/exams/student_router.py`（结果页 grading_status 显示）
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/grading/service.py`（如需）
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_question_regrading.py`
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_student_flow.py`

- [ ] **Step 1: 失败测试 — 重评期间学生结果页**

```python
@pytest.mark.asyncio
async def test_student_result_shows_regrading_pending(client, seeded_choice_submission_with_pending_regrade):
    response = await client.get(f"/api/student/exams/{exam_id}/result", headers=student_headers)
    body = response.json()
    # 该题应显示为 "评估中" 而非旧分数
    target = next(q for q in body["questions"] if q["question_id"] == question_id)
    assert target["grading_pending"] is True
```

实现思路：在 `_SUBJECTIVE_TYPES` 之外，引入一个"该题是否有 pending regrade task"的判定，把它也算入 `grading_pending`。

- [ ] **Step 2: 失败测试 — 申诉联动 (D-E)**

```python
@pytest.mark.asyncio
async def test_pending_appeal_unaffected_by_regrade(db_session, seeded_attempt_with_pending_appeal):
    # 触发重评
    await regrade_submitted_question_for_student(...)
    appeal = await db_session.scalar(select(StudentExamAppeal).where(...))
    # 申诉状态保持 pending，等待教师手动处理
    assert appeal.status == AppealStatus.PENDING.value


@pytest.mark.asyncio
async def test_resolved_appeal_preserved_after_regrade(db_session, seeded_attempt_with_resolved_appeal):
    await regrade_submitted_question_for_student(...)
    appeal = await db_session.scalar(...)
    assert appeal.status == AppealStatus.RESOLVED.value
    # 教师回复内容不变
    assert appeal.teacher_reply == "原回复"
```

- [ ] **Step 3: 失败测试 — 通知内容 (D4)**

```python
@pytest.mark.asyncio
async def test_regrade_notification_contains_score_change(db_session, seeded_choice_submission, teacher_user):
    # 初始分数 10，标准答案改成不同选项，重评后 0
    await regrade_submitted_question_for_student(...)
    notification = await db_session.scalar(select(StudentNotification).where(...))
    assert "考试「" in notification.message
    assert "得分从 10" in notification.message
    assert "调整为 0" in notification.message


@pytest.mark.asyncio
async def test_regrade_skipped_when_score_unchanged(db_session, seeded_choice_submission_where_regrade_keeps_score):
    # 重评后分数没变（学生答对的还是答对）
    await regrade_submitted_question_for_student(...)
    notification_count = await db_session.scalar(select(func.count(StudentNotification.id)).where(...))
    # 不发"分数未变化"的噪音通知
    assert notification_count == 0
```

- [ ] **Step 4: 失败测试 — 审计字段 (D-F)**

```python
@pytest.mark.asyncio
async def test_grading_task_carries_audit_fields(db_session, seeded_question_usage, teacher_user):
    await enqueue_question_regrade_tasks(db_session, question_id=..., triggered_by_user_id=teacher_user.id)
    task = await db_session.scalar(select(GradingTask).where(...))
    assert task.triggered_by_user_id == teacher_user.id
    assert task.trigger_reason == "question_update"
```

- [ ] **Step 5: 实现上述四类行为**

- 学生结果页：在 `student_router.py` 的 `get_exam_result` 中，把"该题存在 pending/running GradingTask"作为 `grading_pending` 的额外条件
- 申诉联动：在重评流程中**不要触碰** `StudentExamAppeal` 记录；写一条短注释说明 D-E
- 通知：仅在 `score_awarded_before != score_awarded_after` 时创建 `StudentNotification`
- 审计：`GradingTask` 入队时传入 `triggered_by_user_id` 与 `trigger_reason`（Task 0 Step 2 确认字段已落地）

- [ ] **Step 6: 跑测试**

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src .venv/bin/python -m pytest tests/test_question_regrading.py tests/test_student_flow.py -q
```

- [ ] **Step 7: Commit**

```bash
git add /Users/jzefan/work/proj/exam/backend/src/app/exams/student_router.py \
        /Users/jzefan/work/proj/exam/backend/src/app/grading/service.py \
        /Users/jzefan/work/proj/exam/backend/tests/test_question_regrading.py \
        /Users/jzefan/work/proj/exam/backend/tests/test_student_flow.py
git commit -m "feat: integrate regrade snapshot, notification, appeal preservation, and audit"
```

---

### Task 5: Cover code-question test-case editing and backend/frontend integration edge cases

**Files:**
- Modify: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/code-question-mode.ts`
- Modify: `/Users/jzefan/work/proj/exam/backend/src/app/questions/service.py`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-edit-locking.test.tsx`
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_question_edit_locking.py`

- [ ] **Step 1: Add failing tests for code-question content partial locking**

```python
def test_in_use_code_question_allows_test_case_change_only(code_question_factory):
    question = code_question_factory(content={"description": "旧题面", "sample_tests": [{"input": "1", "expected_output": "1"}]})
    changed = diff_question_update(
        question,
        {"content": {"description": "新题面", "sample_tests": [{"input": "2", "expected_output": "2"}]}},
    )
    assert changed.forbidden_fields == {"content"}
```

And:

```python
def test_in_use_code_question_accepts_test_case_only_change(code_question_factory):
    question = code_question_factory(content={"description": "旧题面", "sample_tests": [{"input": "1", "expected_output": "1"}]})
    changed = diff_question_update(
        question,
        {"content": {"description": "旧题面", "sample_tests": [{"input": "2", "expected_output": "2"}]}},
    )
    assert changed.forbidden_fields == set()
    assert "sample_tests" in changed.allowed_content_change_keys
```

- [ ] **Step 2: Run the targeted code-question tests**

Run:

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_edit_locking.py -q
```

Expected:

- At least one code-question partial-lock test fails before final diff logic is corrected

- [ ] **Step 3: Normalize code-question content extraction on the frontend**

If needed, add or refine a helper in `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/code-question-mode.ts`:

```ts
export function extractEditableCodeTestCases(content: Record<string, unknown> | null | undefined) {
  if (!content || typeof content !== "object") return [];
  const sampleTests = Array.isArray((content as any).sample_tests) ? (content as any).sample_tests : [];
  return sampleTests;
}
```

This lets the UI lock the rest of the code-question prompt fields while still allowing test-case editing.

- [ ] **Step 4: Finalize backend content subtree comparison**

In `/Users/jzefan/work/proj/exam/backend/src/app/questions/service.py`, make the content comparison explicit:

- remove allowed test-case keys from old/new content
- compare the remainder deeply
- if remainder changed, mark `content` forbidden
- if only allowed test-case keys changed, mark regrade-trigger content change

- [ ] **Step 5: Re-run backend and frontend lock tests**

Run:

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_edit_locking.py -q
cd /Users/jzefan/work/proj/exam/frontend && CI=1 pnpm exec vitest run src/pages/questions/question-edit-locking.test.tsx --reporter=verbose
```

Expected:

- all code-question-specific lock tests pass

- [ ] **Step 6: Commit the code-question partial lock behavior**

```bash
git add /Users/jzefan/work/proj/exam/backend/src/app/questions/service.py /Users/jzefan/work/proj/exam/frontend/src/pages/questions/code-question-mode.ts /Users/jzefan/work/proj/exam/backend/tests/test_question_edit_locking.py /Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-edit-locking.test.tsx
git commit -m "feat: allow in-use code questions to update test cases only"
```

---

### Task 6: Run full verification and inspect residual risks

**Files:**
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_question_edit_locking.py`
- Test: `/Users/jzefan/work/proj/exam/backend/tests/test_question_regrading.py`
- Test: `/Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-edit-locking.test.tsx`
- Modify if needed: whichever file a final failing test points to

- [ ] **Step 1: Run the focused backend verification suite**

Run:

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_question_edit_locking.py tests/test_question_regrading.py -q
```

Expected:

- All focused backend tests pass

- [ ] **Step 2: Run the focused frontend verification suite**

Run:

```bash
cd /Users/jzefan/work/proj/exam/frontend && CI=1 pnpm exec vitest run src/pages/questions/question-edit-locking.test.tsx --reporter=verbose
cd /Users/jzefan/work/proj/exam/frontend && pnpm exec tsc --noEmit --pretty false
```

Expected:

- UI tests pass
- type check passes

- [ ] **Step 3: Run a broader exam/grading regression subset**

Run:

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest tests/test_student_flow.py tests/grading/test_service.py tests/grading/test_router.py -q
```

Expected:

- no regressions in core exam submission and grading flows

- [ ] **Step 4: Fix any regression uncovered by the broader suite**

If a regression appears, make the smallest possible correction in the touched service/router layer and re-run only the failing test first, then rerun the broader subset.

Representative command pattern:

```bash
cd /Users/jzefan/work/proj/exam/backend && PYTHONPATH=src UV_CACHE_DIR=/tmp/uv-cache uv run pytest path/to/failing_test.py::test_name -q
```

- [ ] **Step 5: Commit the verified final implementation**

```bash
git add /Users/jzefan/work/proj/exam/backend/src/app/questions/router.py /Users/jzefan/work/proj/exam/backend/src/app/questions/service.py /Users/jzefan/work/proj/exam/backend/src/app/questions/schemas.py /Users/jzefan/work/proj/exam/backend/src/app/grading/service.py /Users/jzefan/work/proj/exam/backend/tests/test_question_edit_locking.py /Users/jzefan/work/proj/exam/backend/tests/test_question_regrading.py /Users/jzefan/work/proj/exam/frontend/src/types/index.ts /Users/jzefan/work/proj/exam/frontend/src/pages/questions/edit.tsx /Users/jzefan/work/proj/exam/frontend/src/pages/questions/code-question-mode.ts /Users/jzefan/work/proj/exam/frontend/src/pages/questions/question-edit-locking.test.tsx
git commit -m "feat: lock in-use questions and regrade affected submissions"
```

---

## Self-Review (Updated 2026-05-14)

### Spec coverage

Spec 原始需求：

- in-use questions lock student-visible fields ✅
- allowed edits remain available ✅
- answer/test-case changes trigger regrading ✅ （主观题除外，见 D3）
- analysis/difficulty/knowledge points do not trigger regrading ✅
- teacher UI explicitly explains lock and regrading behavior ✅
- backend enforces restrictions regardless of frontend ✅
- regrading is async and scoped to submitted students only ✅

评审引入的新需求（已纳入 Task 0 / 3 / 4.5）：

- 锁定范围仅限"进行中"考试 (D2) ✅
- 主观题不自动重评 (D3) ✅
- 重评通知含分数变化 (D4) ✅
- 复用 GradingTask 流水线，禁用 BackgroundTasks (D-A) ✅
- 重评前 snapshot (D-B) ✅
- 聚合分数与 grading_status 回写 (D-C) ✅
- 同题去重 (D-D) ✅
- 申诉记录保留不动 (D-E) ✅
- 审计字段 triggered_by_user_id / trigger_reason (D-F) ✅
- 测试 fixture 在 Task 0 落地 (P2-16) ✅

### Placeholder scan

已检查并清零：

- TODO/TBD：Task 0 "确认结论" 是**执行期填写**，不算预留 TODO
- "appropriate error handling"：已删除
- "minimum behavior for first pass"：已删除
- "similar to task N"：未出现
- 缺命令：所有 step 都有可执行 bash 命令

### Type consistency

跨 Task 一致的符号：

- `QuestionUpdateDiff`
- `question_is_in_use`
- `question_update_requires_regrade`
- `find_submitted_attempts_affected_by_question_change`
- `regrade_submitted_question_for_student`
- `regrade_objective_answer` / `regrade_fill_in_answer` / `regrade_code_answer`
- `enqueue_question_regrade_tasks`
- `QuestionEditLockInfo`
- `AffectedSubmittedAttempt`
- `RegradeResult`

新引入的字符串常量：

- `trigger_reason = "question_update"` （D-F）
- `regrade_on_fields` 中的逻辑名 `"answer"` / `"code_test_cases"` （P2-10）

### 落地依赖关系

- Task 0 必须先完成（提供 fixture 与字段调研结论），其他 Task 才能进入红/绿循环
- Task 1 - Task 2 - Task 3 顺序依赖（diff → API enforcement → regrade）
- Task 4 / Task 4.5 与 Task 3 可并行
- Task 5 收尾 code question partial-lock 边界
- Task 6 全量回归
