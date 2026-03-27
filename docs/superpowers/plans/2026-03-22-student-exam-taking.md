# 学生考试功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现学生端考试功能：考试列表（未参加/已参加标签）、考试须知弹窗、考试答题界面（倒计时、切屏检测、题目导航、多题型答题、提交）

**Architecture:** 新增 `student_answers` 表存储学生答案，新增 `/api/student/exams` 学生专属 API。前端新增考试答题页面 `/my-exams/:id/take`，使用已有的 Tiptap 富文本编辑器、Radix UI 组件库。前端考试页面使用独立布局（无侧边栏），防作弊通过 `visibilitychange` 事件检测切屏。

**Tech Stack:** FastAPI, SQLAlchemy (async), Alembic, React 19, React Router, Refine, Radix UI, Tiptap, TailwindCSS, TypeScript

---

## Scope

本计划覆盖以下功能，**不包含**编程题和 AI 自动评判（下一阶段实现）：

| 包含 | 不包含 |
|------|--------|
| 学生考试列表（未参加/已参加标签） | 编程题答题 |
| 考试须知弹窗 | AI 自动评判主观题 |
| 考试倒计时 | 评判规则配置 |
| 切屏检测与次数限制 | 考试成绩详情页 |
| 5种题型答题（判断、选择、填空、简答、论述） | |
| 题目导航（按题型分组） | |
| 单题/全部显示切换 | |
| 答案自动保存 + 手动提交 | |
| 论述题附件上传 | |

---

## File Structure

### Backend - New Files

| File | Responsibility |
|------|---------------|
| `backend/src/app/student/__init__.py` | Student module init |
| `backend/src/app/student/models.py` | `StudentAnswer` model |
| `backend/src/app/student/schemas.py` | Pydantic schemas for student exam API |
| `backend/src/app/student/router.py` | Student exam API endpoints |
| `backend/src/app/student/service.py` | Business logic (答案保存、提交、切屏记录) |
| `backend/alembic/versions/xxx_add_student_answers.py` | Migration for student_answers table |

### Backend - Modified Files

| File | Change |
|------|--------|
| `backend/src/app/main.py` | Register student router |
| `backend/src/app/exams/models.py` | Add `switch_count` and `started_at` to `ExamStudent` |
| `backend/src/app/uploads/router.py` | Add general file upload endpoint `POST /file` (for essay attachments) |

### Frontend - New Files

| File | Responsibility |
|------|---------------|
| `frontend/src/pages/student/exam-taking.tsx` | 考试答题主页面（布局、倒计时、切屏检测） |
| `frontend/src/pages/student/components/exam-notice-dialog.tsx` | 考试须知弹窗 |
| `frontend/src/pages/student/components/question-nav.tsx` | 题目导航面板（按题型分组） |
| `frontend/src/pages/student/components/question-renderer.tsx` | 题型路由（根据类型渲染不同答题组件） |
| `frontend/src/pages/student/components/true-false-question.tsx` | 判断题组件 |
| `frontend/src/pages/student/components/choice-question.tsx` | 选择题组件（单选/多选） |
| `frontend/src/pages/student/components/fill-in-question.tsx` | 填空题组件 |
| `frontend/src/pages/student/components/short-answer-question.tsx` | 简答题组件（Tiptap） |
| `frontend/src/pages/student/components/essay-question.tsx` | 论述题组件（Tiptap + 附件上传） |
| `frontend/src/pages/student/components/countdown-timer.tsx` | 倒计时组件 |
| `frontend/src/pages/student/components/switch-counter.tsx` | 切屏次数显示组件 |
| `frontend/src/hooks/use-exam-taking.ts` | 考试状态管理 hook（答案缓存、自动保存） |
| `frontend/src/hooks/use-visibility-detection.ts` | 切屏检测 hook |

### Frontend - Modified Files

| File | Change |
|------|--------|
| `frontend/src/App.tsx` | 添加 `/my-exams/:id/take` 路由 |
| `frontend/src/pages/student/my-exams.tsx` | 重构为"未参加/已参加"标签，接入学生专属 API |
| `frontend/src/types/index.ts` | 添加 StudentAnswer、ExamTaking 等类型 |

---

## Phase 1: Backend Data Model & API

### Task 1: StudentAnswer 数据模型

**Files:**
- Create: `backend/src/app/student/__init__.py`
- Create: `backend/src/app/student/models.py`
- Modify: `backend/src/app/exams/models.py` (add fields to ExamStudent)

- [ ] **Step 1: 创建 student 模块 init**

```python
# backend/src/app/student/__init__.py
```

- [ ] **Step 2: 创建 StudentAnswer 模型**

```python
# backend/src/app/student/models.py
"""Student answer model for exam submissions."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models import Base, BaseModel


class StudentAnswer(BaseModel):
    __tablename__ = "student_answers"

    exam_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("exams.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False
    )
    answer_content: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # answer_content 格式：
    # 判断题: {"value": true/false}
    # 选择题: {"selected": ["A"] 或 ["A","B"]}
    # 填空题: {"blanks": ["答案1", "答案2"]}
    # 简答题: {"html": "<p>...</p>"}
    # 论述题: {"html": "<p>...</p>", "attachments": [{"name": "...", "url": "..."}]}

    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_graded: Mapped[bool] = mapped_column(default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint("exam_id", "student_id", "question_id", name="uq_student_answer"),
    )
```

- [ ] **Step 3: 给 ExamStudent 添加 switch_count 和 started_at 字段**

在 `backend/src/app/exams/models.py` 的 `ExamStudent` 类中添加：

```python
switch_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 4: 生成 Alembic migration**

Run: `cd /Users/jzefan/work/proj/exam/backend && alembic revision --autogenerate -m "add_student_answers_and_exam_student_fields"`

- [ ] **Step 5: 执行 migration**

Run: `cd /Users/jzefan/work/proj/exam/backend && alembic upgrade head`

- [ ] **Step 6: 验证数据库表结构**

Run: `cd /Users/jzefan/work/proj/exam/backend && python -c "from app.student.models import StudentAnswer; print('OK')"`

---

### Task 2: Student Exam Schemas

**Files:**
- Create: `backend/src/app/student/schemas.py`

- [ ] **Step 1: 创建学生考试相关 Pydantic schemas**

```python
# backend/src/app/student/schemas.py
"""Pydantic schemas for student exam API."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ── 考试列表 ──

class MyExamResponse(BaseModel):
    """学生考试列表项"""
    model_config = {"from_attributes": True}

    id: uuid.UUID
    title: str
    description: str | None
    start_time: datetime | None
    end_time: datetime | None
    duration_minutes: int
    total_score: float
    status: str
    notes_template: str | None
    max_switch_count: int
    total_questions: int = 0
    participated: bool = False  # 是否已参加（已提交）
    started_at: datetime | None = None  # 开始答题时间
    submitted_at: datetime | None = None


# ── 开始考试 ──

class ExamQuestionForStudent(BaseModel):
    """学生看到的题目（不含答案）"""
    model_config = {"from_attributes": True}

    question_id: uuid.UUID
    order: int
    score: float  # score_override or question.score
    type: str
    title: str
    content: dict
    options: dict | None = None
    # 不返回 answer 和 analysis


class ExamTakingResponse(BaseModel):
    """进入考试后返回的完整数据"""
    exam_id: uuid.UUID
    title: str
    duration_minutes: int
    max_switch_count: int
    started_at: datetime
    end_time: datetime | None
    questions: list[ExamQuestionForStudent]
    saved_answers: dict[str, dict] = Field(default_factory=dict)
    # key = question_id (str), value = answer_content
    switch_count: int = 0


# ── 保存答案 ──

class SaveAnswerRequest(BaseModel):
    question_id: uuid.UUID
    answer_content: dict


class SaveAnswerBatchRequest(BaseModel):
    answers: list[SaveAnswerRequest]


# ── 切屏上报 ──

class SwitchReportRequest(BaseModel):
    switch_count: int


class SwitchReportResponse(BaseModel):
    switch_count: int
    max_switch_count: int
    force_submit: bool = False


# ── 提交考试 ──

class SubmitExamResponse(BaseModel):
    submitted_at: datetime
    message: str = "考试已提交"
```

---

### Task 3: Student Exam Service

**Files:**
- Create: `backend/src/app/student/service.py`

- [ ] **Step 1: 创建学生考试服务层**

```python
# backend/src/app/student/service.py
"""Business logic for student exam operations."""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.exams.models import Exam, ExamQuestion, ExamStatus, ExamStudent
from app.questions.models import Question
from app.student.models import StudentAnswer
from app.student.schemas import (
    ExamQuestionForStudent,
    ExamTakingResponse,
    MyExamResponse,
)


async def list_my_exams(
    db: AsyncSession, student_id: uuid.UUID
) -> list[MyExamResponse]:
    """获取当前学生的所有考试，按 start_time 排序"""
    query = (
        select(Exam, ExamStudent)
        .join(ExamStudent, ExamStudent.exam_id == Exam.id)
        .where(
            ExamStudent.student_id == student_id,
            Exam.deleted_at.is_(None),
            Exam.status.in_([
                ExamStatus.UPCOMING.value,
                ExamStatus.ONGOING.value,
                ExamStatus.COMPLETED.value,
                ExamStatus.CLOSED.value,
            ]),
        )
        .order_by(Exam.start_time.desc())
    )
    result = await db.execute(query)
    rows = result.unique().all()

    exams = []
    for exam, es in rows:
        exams.append(
            MyExamResponse(
                id=exam.id,
                title=exam.title,
                description=exam.description,
                start_time=exam.start_time,
                end_time=exam.end_time,
                duration_minutes=exam.duration_minutes,
                total_score=exam.total_score,
                status=exam.status,
                notes_template=exam.notes_template,
                max_switch_count=exam.max_switch_count,
                total_questions=len(exam.exam_questions),
                participated=es.submitted_at is not None,
                started_at=es.started_at,
                submitted_at=es.submitted_at,
            )
        )
    return exams


async def start_exam(
    db: AsyncSession, exam_id: uuid.UUID, student_id: uuid.UUID
) -> ExamTakingResponse:
    """开始考试：校验状态、记录开始时间、返回题目"""
    # 1. 查询考试和学生关联
    result = await db.execute(
        select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    )
    exam = result.scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "考试不存在")

    result = await db.execute(
        select(ExamStudent).where(
            ExamStudent.exam_id == exam_id,
            ExamStudent.student_id == student_id,
        )
    )
    es = result.scalar_one_or_none()
    if es is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "你未被分配到此考试")

    if es.submitted_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "你已提交此考试")

    if exam.status != ExamStatus.ONGOING.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "考试当前不可参加")

    # 2. 记录开始时间（首次进入时）
    now = datetime.now(timezone.utc)
    if es.started_at is None:
        es.started_at = now
        await db.flush()

    # 3. 构建题目列表（不含答案）
    sorted_eqs = sorted(exam.exam_questions, key=lambda x: x.order)
    questions = []
    for eq in sorted_eqs:
        q = eq.question
        if q is None:
            continue
        questions.append(
            ExamQuestionForStudent(
                question_id=q.id,
                order=eq.order,
                score=eq.score_override if eq.score_override is not None else q.score,
                type=q.type.value,
                title=q.title,
                content=q.content,
                options=q.options,
            )
        )

    # 4. 查询已保存的答案
    ans_result = await db.execute(
        select(StudentAnswer).where(
            StudentAnswer.exam_id == exam_id,
            StudentAnswer.student_id == student_id,
            StudentAnswer.deleted_at.is_(None),
        )
    )
    saved = {str(a.question_id): a.answer_content for a in ans_result.scalars().all()}

    await db.commit()

    return ExamTakingResponse(
        exam_id=exam.id,
        title=exam.title,
        duration_minutes=exam.duration_minutes,
        max_switch_count=exam.max_switch_count,
        started_at=es.started_at,
        end_time=exam.end_time,
        questions=questions,
        saved_answers=saved,
        switch_count=es.switch_count,
    )


async def save_answers(
    db: AsyncSession,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
    answers: list[tuple[uuid.UUID, dict]],
) -> int:
    """保存学生答案（upsert 逻辑）"""
    # 校验考试状态
    result = await db.execute(
        select(ExamStudent).where(
            ExamStudent.exam_id == exam_id,
            ExamStudent.student_id == student_id,
        )
    )
    es = result.scalar_one_or_none()
    if es is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "你未被分配到此考试")
    if es.submitted_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "考试已提交，无法修改答案")

    saved_count = 0
    for question_id, answer_content in answers:
        # 查找已有答案
        existing = await db.execute(
            select(StudentAnswer).where(
                StudentAnswer.exam_id == exam_id,
                StudentAnswer.student_id == student_id,
                StudentAnswer.question_id == question_id,
                StudentAnswer.deleted_at.is_(None),
            )
        )
        ans = existing.scalar_one_or_none()
        if ans:
            ans.answer_content = answer_content
        else:
            db.add(
                StudentAnswer(
                    exam_id=exam_id,
                    student_id=student_id,
                    question_id=question_id,
                    answer_content=answer_content,
                )
            )
        saved_count += 1

    await db.commit()
    return saved_count


async def report_switch(
    db: AsyncSession,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
    switch_count: int,
) -> tuple[int, int, bool]:
    """上报切屏次数，返回 (当前次数, 最大次数, 是否强制提交)"""
    result = await db.execute(
        select(ExamStudent, Exam)
        .join(Exam, Exam.id == ExamStudent.exam_id)
        .where(
            ExamStudent.exam_id == exam_id,
            ExamStudent.student_id == student_id,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "你未被分配到此考试")

    es, exam = row
    if es.submitted_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "考试已提交")

    es.switch_count = switch_count
    force_submit = exam.max_switch_count > 0 and switch_count >= exam.max_switch_count

    await db.commit()
    return switch_count, exam.max_switch_count, force_submit


async def submit_exam(
    db: AsyncSession,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
) -> datetime:
    """提交考试"""
    result = await db.execute(
        select(ExamStudent).where(
            ExamStudent.exam_id == exam_id,
            ExamStudent.student_id == student_id,
        )
    )
    es = result.scalar_one_or_none()
    if es is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "你未被分配到此考试")
    if es.submitted_at is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "考试已提交")

    now = datetime.now(timezone.utc)
    es.submitted_at = now
    await db.commit()
    return now
```

---

### Task 4: Student Exam Router

**Files:**
- Create: `backend/src/app/student/router.py`
- Modify: `backend/src/app/main.py`

- [ ] **Step 1: 创建学生考试 API 路由**

```python
# backend/src/app/student/router.py
"""Student exam API endpoints."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, require_roles
from app.auth.models import UserRole
from app.database import get_db
from app.student import service
from app.student.schemas import (
    MyExamResponse,
    ExamTakingResponse,
    SaveAnswerBatchRequest,
    SubmitExamResponse,
    SwitchReportRequest,
    SwitchReportResponse,
)

router = APIRouter(dependencies=[require_roles(UserRole.STUDENT)])


@router.get("/exams", response_model=list[MyExamResponse])
async def list_my_exams(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> list[MyExamResponse]:
    """获取当前学生的考试列表"""
    return await service.list_my_exams(db, user.id)


@router.post("/exams/{exam_id}/start", response_model=ExamTakingResponse)
async def start_exam(
    exam_id: uuid.UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> ExamTakingResponse:
    """开始考试：返回题目和已保存答案"""
    return await service.start_exam(db, exam_id, user.id)


@router.post("/exams/{exam_id}/answers")
async def save_answers(
    exam_id: uuid.UUID,
    body: SaveAnswerBatchRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """批量保存答案"""
    answers = [(a.question_id, a.answer_content) for a in body.answers]
    count = await service.save_answers(db, exam_id, user.id, answers)
    return {"saved": count}


@router.post("/exams/{exam_id}/switch")
async def report_switch(
    exam_id: uuid.UUID,
    body: SwitchReportRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> SwitchReportResponse:
    """上报切屏次数"""
    current, max_count, force = await service.report_switch(
        db, exam_id, user.id, body.switch_count
    )
    return SwitchReportResponse(
        switch_count=current,
        max_switch_count=max_count,
        force_submit=force,
    )


@router.post("/exams/{exam_id}/submit", response_model=SubmitExamResponse)
async def submit_exam(
    exam_id: uuid.UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> SubmitExamResponse:
    """提交考试"""
    submitted_at = await service.submit_exam(db, exam_id, user.id)
    return SubmitExamResponse(submitted_at=submitted_at)
```

- [ ] **Step 2: 添加通用文件上传端点**

在 `backend/src/app/uploads/router.py` 中添加：

```python
ALLOWED_FILE_TYPES = {
    "application/pdf", "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain", "application/zip",
} | ALLOWED_IMAGE_TYPES

MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024  # 20MB


@router.post("/file")
async def upload_file(file: UploadFile) -> dict[str, str]:
    if file.content_type not in ALLOWED_FILE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型: {file.content_type}",
        )

    contents = await file.read()
    if len(contents) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(status_code=400, detail="文件大小不能超过 20MB")

    ext = Path(file.filename or "file").suffix or ".bin"
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    filepath.write_bytes(contents)

    return {"url": f"/api/uploads/files/{filename}"}
```

- [ ] **Step 3: 在 main.py 注册路由**

在 `backend/src/app/main.py` 中添加：

```python
from app.student.router import router as student_router
# ...
app.include_router(student_router, prefix="/api/student", tags=["student"])
```

- [ ] **Step 4: 验证 API 启动正常**

Run: `cd /Users/jzefan/work/proj/exam/backend && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &`
验证: `curl http://localhost:8000/api/health`

- [ ] **Step 5: Commit backend changes**

```bash
git add backend/src/app/student/ backend/src/app/main.py backend/src/app/exams/models.py backend/src/app/uploads/router.py backend/alembic/versions/
git commit -m "feat: add student exam API with answer saving and submission"
```

---

## Phase 2: Frontend Types & Hooks

### Task 5: TypeScript Types

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: 添加学生考试相关类型**

在 `frontend/src/types/index.ts` 末尾添加：

```typescript
// ── Student Exam Taking ──

export interface IMyExam {
  id: string;
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  total_score: number;
  status: ExamStatus;
  notes_template: string | null;
  max_switch_count: number;
  total_questions: number;
  participated: boolean;
  started_at: string | null;
  submitted_at: string | null;
}

export interface IExamQuestionForStudent {
  question_id: string;
  order: number;
  score: number;
  type: QuestionType;
  title: string;
  content: Record<string, unknown>;
  options: Record<string, unknown> | null;
}

export interface IExamTaking {
  exam_id: string;
  title: string;
  duration_minutes: number;
  max_switch_count: number;
  started_at: string;
  end_time: string | null;
  questions: IExamQuestionForStudent[];
  saved_answers: Record<string, Record<string, unknown>>;
  switch_count: number;
}

export interface ISwitchReportResponse {
  switch_count: number;
  max_switch_count: number;
  force_submit: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: add student exam taking TypeScript types"
```

---

### Task 6: Visibility Detection Hook

**Files:**
- Create: `frontend/src/hooks/use-visibility-detection.ts`

- [ ] **Step 1: 创建切屏检测 hook**

```typescript
// frontend/src/hooks/use-visibility-detection.ts
import { useEffect, useRef, useCallback } from "react";

interface UseVisibilityDetectionOptions {
  maxSwitchCount: number;
  onSwitch: (count: number) => void;
  onMaxReached: () => void;
  onWarning: (remaining: number) => void;
  enabled: boolean;
}

export function useVisibilityDetection({
  maxSwitchCount,
  onSwitch,
  onMaxReached,
  onWarning,
  enabled,
}: UseVisibilityDetectionOptions) {
  const countRef = useRef(0);

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden && enabled) {
      countRef.current += 1;
      const count = countRef.current;
      onSwitch(count);

      if (maxSwitchCount > 0) {
        const remaining = maxSwitchCount - count;
        if (remaining <= 0) {
          onMaxReached();
        } else if (remaining <= 2) {
          onWarning(remaining);
        }
      }
    }
  }, [enabled, maxSwitchCount, onSwitch, onMaxReached, onWarning]);

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, handleVisibilityChange]);

  const setCount = useCallback((c: number) => {
    countRef.current = c;
  }, []);

  return { count: countRef, setCount };
}
```

---

### Task 7: Exam Taking Hook

**Files:**
- Create: `frontend/src/hooks/use-exam-taking.ts`

- [ ] **Step 1: 创建考试状态管理 hook**

该 hook 管理：答案状态、自动保存（30秒防抖）、手动提交

```typescript
// frontend/src/hooks/use-exam-taking.ts
import { useState, useCallback, useRef, useEffect } from "react";
import axios from "axios";
import type { IExamTaking } from "@/types";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

interface UseExamTakingOptions {
  examData: IExamTaking | null;
}

export function useExamTaking({ examData }: UseExamTakingOptions) {
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const dirtyRef = useRef(new Set<string>());
  const answersRef = useRef(answers);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 保持 answersRef 同步
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // 初始化已保存的答案
  useEffect(() => {
    if (examData?.saved_answers) {
      setAnswers(examData.saved_answers);
    }
  }, [examData?.saved_answers]);

  // 更新单题答案
  const updateAnswer = useCallback(
    (questionId: string, content: Record<string, unknown>) => {
      setAnswers((prev) => ({ ...prev, [questionId]: content }));
      dirtyRef.current.add(questionId);

      // 30秒自动保存防抖
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        flushAnswers();
      }, 30_000);
    },
    []
  );

  // 立即保存所有 dirty 答案（使用 ref 避免 stale closure）
  const flushAnswers = useCallback(() => {
    if (!examData || dirtyRef.current.size === 0) return;

    const currentAnswers = answersRef.current;
    const batch = Array.from(dirtyRef.current).map((qid) => ({
      question_id: qid,
      answer_content: currentAnswers[qid] ?? {},
    }));
    dirtyRef.current.clear();

    api.post(`/api/student/exams/${examData.exam_id}/answers`, { answers: batch });
  }, [examData]);

  // 提交考试
  const submitExam = useCallback(async () => {
    if (!examData) return;
    flushAnswers();
    await api.post(`/api/student/exams/${examData.exam_id}/submit`);
  }, [examData, flushAnswers]);

  // 上报切屏
  const reportSwitch = useCallback(
    (count: number) => {
      if (!examData) return;
      api.post(`/api/student/exams/${examData.exam_id}/switch`, { switch_count: count });
    },
    [examData]
  );

  // 清理定时器 + beforeunload 保护
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current.size > 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  return {
    answers,
    currentIndex,
    setCurrentIndex,
    showAll,
    setShowAll,
    updateAnswer,
    flushAnswers,
    submitExam,
    reportSwitch,
  };
}
```

- [ ] **Step 2: Commit hooks**

```bash
git add frontend/src/hooks/
git commit -m "feat: add exam taking hooks (visibility detection, state management)"
```

---

## Phase 3: Frontend Question Components

### Task 8: 题型答题组件

**Files:**
- Create: `frontend/src/pages/student/components/true-false-question.tsx`
- Create: `frontend/src/pages/student/components/choice-question.tsx`
- Create: `frontend/src/pages/student/components/fill-in-question.tsx`
- Create: `frontend/src/pages/student/components/short-answer-question.tsx`
- Create: `frontend/src/pages/student/components/essay-question.tsx`
- Create: `frontend/src/pages/student/components/question-renderer.tsx`

- [ ] **Step 1: 判断题组件**

```tsx
// frontend/src/pages/student/components/true-false-question.tsx
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import type { IExamQuestionForStudent } from "@/types";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function TrueFalseQuestion({ question, answer, onChange }: Props) {
  const selected = answer?.value as boolean | undefined;

  return (
    <div className="space-y-4">
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{
          __html: (question.content as { text?: string }).text ?? question.title,
        }}
      />
      <div className="flex gap-3">
        <Button
          variant={selected === true ? "default" : "outline"}
          size="lg"
          className="flex-1 gap-2"
          onClick={() => onChange({ value: true })}
        >
          <Check size={18} /> 正确
        </Button>
        <Button
          variant={selected === false ? "default" : "outline"}
          size="lg"
          className="flex-1 gap-2"
          onClick={() => onChange({ value: false })}
        >
          <X size={18} /> 错误
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 选择题组件**

```tsx
// frontend/src/pages/student/components/choice-question.tsx
import { Checkbox } from "@/components/ui/checkbox";
import type { IExamQuestionForStudent } from "@/types";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function ChoiceQuestion({ question, answer, onChange }: Props) {
  const options = question.options as Record<string, string> | null;
  const selected = ((answer?.selected as string[]) ?? []);
  // 判断是否多选：检查 content 中是否有 multi 标记，或标准答案为数组
  const isMulti = (question.content as { multi?: boolean }).multi === true;

  if (!options) return <p className="text-muted-foreground">题目选项数据缺失</p>;

  const toggle = (key: string) => {
    if (isMulti) {
      const next = selected.includes(key)
        ? selected.filter((k) => k !== key)
        : [...selected, key];
      onChange({ selected: next });
    } else {
      onChange({ selected: [key] });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{
            __html: (question.content as { text?: string }).text ?? question.title,
          }}
        />
        {isMulti && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">多选</span>
        )}
      </div>
      <div className="space-y-2">
        {Object.entries(options)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, text]) => {
            const checked = selected.includes(key);
            return (
              <label
                key={key}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  checked
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-foreground/30"
                }`}
                onClick={() => toggle(key)}
              >
                <Checkbox checked={checked} className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium mr-1.5">{key}.</span>
                  {text}
                </span>
              </label>
            );
          })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 填空题组件**

```tsx
// frontend/src/pages/student/components/fill-in-question.tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IExamQuestionForStudent } from "@/types";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function FillInQuestion({ question, answer, onChange }: Props) {
  const content = question.content as { text?: string; blank_count?: number };
  const blankCount = content.blank_count ?? 1;
  const blanks = ((answer?.blanks as string[]) ?? Array(blankCount).fill(""));

  const updateBlank = (index: number, value: string) => {
    const next = [...blanks];
    // 确保数组长度足够
    while (next.length <= index) next.push("");
    next[index] = value;
    onChange({ blanks: next });
  };

  return (
    <div className="space-y-4">
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: content.text ?? question.title }}
      />
      <div className="space-y-3">
        {Array.from({ length: blankCount }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground w-16 shrink-0">
              空 {i + 1}
            </Label>
            <Input
              value={blanks[i] ?? ""}
              onChange={(e) => updateBlank(i, e.target.value)}
              placeholder={`请填写第 ${i + 1} 个空`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 简答题组件**

```tsx
// frontend/src/pages/student/components/short-answer-question.tsx
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import type { IExamQuestionForStudent } from "@/types";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function ShortAnswerQuestion({ question, answer, onChange }: Props) {
  const html = (answer?.html as string) ?? "";

  return (
    <div className="space-y-4">
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{
          __html: (question.content as { text?: string }).text ?? question.title,
        }}
      />
      <RichTextEditor
        value={html}
        onChange={(content) => onChange({ html: content })}
      />
    </div>
  );
}
```

- [ ] **Step 5: 论述题组件（含附件上传）**

```tsx
// frontend/src/pages/student/components/essay-question.tsx
import { useState } from "react";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Paperclip, X } from "lucide-react";
import type { IExamQuestionForStudent } from "@/types";

interface Attachment {
  name: string;
  url: string;
}

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

export function EssayQuestion({ question, answer, onChange }: Props) {
  const html = (answer?.html as string) ?? "";
  const attachments = ((answer?.attachments as Attachment[]) ?? []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = localStorage.getItem("token");
      const res = await fetch("/api/uploads/file", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      const newAttachment: Attachment = { name: file.name, url: data.url };
      onChange({
        html,
        attachments: [...attachments, newAttachment],
      });
    } catch {
      // 上传失败静默处理，用户可重试
    }
    // 清空 input 以允许重复上传同名文件
    e.target.value = "";
  };

  const removeAttachment = (index: number) => {
    const next = attachments.filter((_, i) => i !== index);
    onChange({ html, attachments: next });
  };

  return (
    <div className="space-y-4">
      <div
        className="prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{
          __html: (question.content as { text?: string }).text ?? question.title,
        }}
      />
      <RichTextEditor
        value={html}
        onChange={(content) => onChange({ html: content, attachments })}
      />
      {/* 附件区域 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <label className="cursor-pointer">
              <Paperclip size={14} />
              上传附件
              <input
                type="file"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          </Button>
          <span className="text-xs text-muted-foreground">
            已上传 {attachments.length} 个附件
          </span>
        </div>
        {attachments.length > 0 && (
          <div className="space-y-1">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded px-3 py-1.5"
              >
                <Paperclip size={12} />
                <span className="flex-1 truncate">{att.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 题型路由组件**

```tsx
// frontend/src/pages/student/components/question-renderer.tsx
import type { IExamQuestionForStudent } from "@/types";
import { TrueFalseQuestion } from "./true-false-question";
import { ChoiceQuestion } from "./choice-question";
import { FillInQuestion } from "./fill-in-question";
import { ShortAnswerQuestion } from "./short-answer-question";
import { EssayQuestion } from "./essay-question";

interface Props {
  question: IExamQuestionForStudent;
  answer: Record<string, unknown>;
  onChange: (answer: Record<string, unknown>) => void;
}

const QUESTION_COMPONENTS: Record<
  string,
  React.ComponentType<Props>
> = {
  true_false: TrueFalseQuestion,
  choice: ChoiceQuestion,
  fill_in: FillInQuestion,
  short_answer: ShortAnswerQuestion,
  essay: EssayQuestion,
};

export function QuestionRenderer({ question, answer, onChange }: Props) {
  const Component = QUESTION_COMPONENTS[question.type];
  if (!Component) {
    return (
      <p className="text-muted-foreground">暂不支持此题型: {question.type}</p>
    );
  }
  return <Component question={question} answer={answer} onChange={onChange} />;
}
```

- [ ] **Step 7: Commit question components**

```bash
git add frontend/src/pages/student/components/
git commit -m "feat: add question type components (true/false, choice, fill-in, short answer, essay)"
```

---

## Phase 4: Frontend Exam UI Components

### Task 9: 倒计时、切屏显示、题目导航组件

**Files:**
- Create: `frontend/src/pages/student/components/countdown-timer.tsx`
- Create: `frontend/src/pages/student/components/switch-counter.tsx`
- Create: `frontend/src/pages/student/components/question-nav.tsx`

- [ ] **Step 1: 倒计时组件**

```tsx
// frontend/src/pages/student/components/countdown-timer.tsx
import { useState, useEffect } from "react";
import { Timer } from "lucide-react";

interface Props {
  /** 考试开始时间 (ISO string) */
  startedAt: string;
  /** 考试时长（分钟） */
  durationMinutes: number;
  /** 考试截止时间 (ISO string, optional) */
  endTime: string | null;
  /** 时间到回调 */
  onTimeUp: () => void;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function CountdownTimer({ startedAt, durationMinutes, endTime, onTimeUp }: Props) {
  const [remaining, setRemaining] = useState<number>(() => {
    const started = new Date(startedAt).getTime();
    const deadline = endTime
      ? Math.min(started + durationMinutes * 60_000, new Date(endTime).getTime())
      : started + durationMinutes * 60_000;
    return Math.max(0, Math.floor((deadline - Date.now()) / 1000));
  });

  useEffect(() => {
    if (remaining <= 0) {
      onTimeUp();
      return;
    }
    const interval = setInterval(() => {
      setRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(interval);
          onTimeUp();
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [remaining <= 0, onTimeUp]);

  const isUrgent = remaining <= 300; // 5分钟以内
  const isDanger = remaining <= 60;  // 1分钟以内

  return (
    <div
      className={`flex items-center gap-1.5 font-mono text-sm font-medium px-3 py-1.5 rounded-lg ${
        isDanger
          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
          : isUrgent
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            : "bg-muted text-foreground"
      }`}
    >
      <Timer size={14} />
      {formatTime(remaining)}
    </div>
  );
}
```

- [ ] **Step 2: 切屏次数显示组件**

```tsx
// frontend/src/pages/student/components/switch-counter.tsx
import { MonitorOff } from "lucide-react";

interface Props {
  switchCount: number;
  maxSwitchCount: number;
}

export function SwitchCounter({ switchCount, maxSwitchCount }: Props) {
  if (maxSwitchCount <= 0) return null;

  const remaining = maxSwitchCount - switchCount;
  const isDanger = remaining <= 0;
  const isWarning = remaining <= 2 && remaining > 0;

  return (
    <div
      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg ${
        isDanger
          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
          : isWarning
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            : "bg-muted text-muted-foreground"
      }`}
    >
      <MonitorOff size={14} />
      切屏 {switchCount}/{maxSwitchCount}
    </div>
  );
}
```

- [ ] **Step 3: 题目导航面板**

```tsx
// frontend/src/pages/student/components/question-nav.tsx
import type { IExamQuestionForStudent } from "@/types";

const TYPE_LABELS: Record<string, string> = {
  true_false: "判断题",
  choice: "选择题",
  fill_in: "填空题",
  short_answer: "简答题",
  essay: "论述题",
  code: "编程题",
};

interface Props {
  questions: IExamQuestionForStudent[];
  answers: Record<string, Record<string, unknown>>;
  currentIndex: number;
  onNavigate: (index: number) => void;
}

export function QuestionNav({ questions, answers, currentIndex, onNavigate }: Props) {
  // 按题型分组
  const groups: { type: string; label: string; items: { index: number; q: IExamQuestionForStudent }[] }[] = [];
  const typeOrder: string[] = [];

  questions.forEach((q, index) => {
    if (!typeOrder.includes(q.type)) typeOrder.push(q.type);
  });

  for (const type of typeOrder) {
    const items = questions
      .map((q, index) => ({ index, q }))
      .filter(({ q }) => q.type === type);
    groups.push({ type, label: TYPE_LABELS[type] ?? type, items });
  }

  const isAnswered = (qid: string) => {
    const ans = answers[qid];
    if (!ans) return false;
    // 简单判断是否有实际内容
    return Object.values(ans).some((v) =>
      Array.isArray(v) ? v.length > 0 && v.some(Boolean) : v !== "" && v !== null && v !== undefined
    );
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">题目导航</h3>
      {groups.map((group) => (
        <div key={group.type} className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">
            {group.label}（{group.items.length}题）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {group.items.map(({ index, q }) => {
              const answered = isAnswered(q.question_id);
              const isCurrent = index === currentIndex;
              return (
                <button
                  key={q.question_id}
                  onClick={() => onNavigate(index)}
                  className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : answered
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "bg-muted text-muted-foreground hover:bg-foreground/10"
                  }`}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 text-xs text-muted-foreground pt-2 border-t">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-primary" /> 当前
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-green-100 dark:bg-green-950" /> 已答
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-muted" /> 未答
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit UI components**

```bash
git add frontend/src/pages/student/components/
git commit -m "feat: add countdown timer, switch counter, and question navigation components"
```

---

## Phase 5: Exam Taking Page & Integration

### Task 10: 考试须知弹窗

**Files:**
- Create: `frontend/src/pages/student/components/exam-notice-dialog.tsx`

- [ ] **Step 1: 创建考试须知弹窗**

```tsx
// frontend/src/pages/student/components/exam-notice-dialog.tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Timer, MonitorOff, FileText } from "lucide-react";
import type { IMyExam } from "@/types";

interface Props {
  exam: IMyExam | null;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ExamNoticeDialog({ exam, open, onConfirm, onCancel }: Props) {
  if (!exam) return null;

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>考试须知</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">
            考试注意事项
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          <h3 className="font-medium text-foreground">{exam.title}</h3>

          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Timer size={14} />
              考试时长：{exam.duration_minutes} 分钟
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText size={14} />
              共 {exam.total_questions} 题，总分 {exam.total_score} 分
            </div>
            {exam.max_switch_count > 0 && (
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <MonitorOff size={14} />
                切屏限制：最多 {exam.max_switch_count} 次，超出将自动提交
              </div>
            )}
          </div>

          {exam.notes_template && (
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">注意事项：</p>
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: exam.notes_template }}
              />
            </div>
          )}

          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-300">
            <p>请确认以下事项：</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>确保网络连接稳定</li>
              <li>考试期间请勿切换窗口</li>
              <li>答案会每30秒自动保存</li>
              <li>考试时间结束将自动提交</li>
            </ul>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>确认进入考试</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

---

### Task 11: 考试答题主页面

**Files:**
- Create: `frontend/src/pages/student/exam-taking.tsx`

- [ ] **Step 1: 创建考试答题主页面**

```tsx
// frontend/src/pages/student/exam-taking.tsx
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronLeft, ChevronRight, List, LayoutGrid, Send } from "lucide-react";
import type { IExamTaking } from "@/types";
import { CountdownTimer } from "./components/countdown-timer";
import { SwitchCounter } from "./components/switch-counter";
import { QuestionNav } from "./components/question-nav";
import { QuestionRenderer } from "./components/question-renderer";
import { useExamTaking } from "@/hooks/use-exam-taking";
import { useVisibilityDetection } from "@/hooks/use-visibility-detection";

const api = axios.create();
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export function ExamTaking() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [examData, setExamData] = useState<IExamTaking | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [switchCount, setSwitchCount] = useState(0);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showSwitchWarning, setShowSwitchWarning] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // 获取考试数据（仅在挂载时调用一次）
  useEffect(() => {
    let cancelled = false;
    api.post<IExamTaking>(`/api/student/exams/${id}/start`).then((res) => {
      if (!cancelled) {
        setExamData(res.data);
        setIsLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  const {
    answers,
    currentIndex,
    setCurrentIndex,
    showAll,
    setShowAll,
    updateAnswer,
    flushAnswers,
    submitExam,
    reportSwitch,
  } = useExamTaking({ examData });

  // 初始化切屏次数
  useEffect(() => {
    if (examData) setSwitchCount(examData.switch_count);
  }, [examData?.switch_count]);

  // 切屏检测
  const handleSwitch = useCallback(
    (count: number) => {
      setSwitchCount(count);
      reportSwitch(count);
    },
    [reportSwitch]
  );

  const handleSubmitRef = useRef<() => void>(() => {});

  const handleMaxReached = useCallback(() => {
    setShowSwitchWarning("切屏次数已达上限，考试将自动提交！");
    setTimeout(() => {
      handleSubmitRef.current();
    }, 2000);
  }, []);

  const handleWarning = useCallback((remaining: number) => {
    setShowSwitchWarning(`警告：你还有 ${remaining} 次切屏机会！`);
    setTimeout(() => setShowSwitchWarning(null), 3000);
  }, []);

  const { setCount: setVisibilityCount } = useVisibilityDetection({
    maxSwitchCount: examData?.max_switch_count ?? 0,
    onSwitch: handleSwitch,
    onMaxReached: handleMaxReached,
    onWarning: handleWarning,
    enabled: !!examData && !submitted,
  });

  // 同步服务端切屏次数到 hook
  useEffect(() => {
    if (examData) setVisibilityCount(examData.switch_count);
  }, [examData?.switch_count, setVisibilityCount]);

  // 提交考试
  const handleSubmit = useCallback(async () => {
    flushAnswers();
    submitExam();
    setSubmitted(true);
    setShowSubmitDialog(false);
    setTimeout(() => navigate("/my-exams"), 1500);
  }, [flushAnswers, submitExam, navigate]);

  // 保持 ref 同步以避免 stale closure
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  // 时间到自动提交
  const handleTimeUp = useCallback(() => {
    setShowSwitchWarning("考试时间已到，正在自动提交...");
    setTimeout(() => handleSubmit(), 1500);
  }, [handleSubmit]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse text-muted-foreground">加载考试中...</div>
      </div>
    );
  }

  if (!examData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">无法加载考试数据</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <div className="text-4xl">✅</div>
        <p className="text-lg font-medium">考试已提交</p>
        <p className="text-sm text-muted-foreground">正在返回考试列表...</p>
      </div>
    );
  }

  const questions = examData.questions;
  const currentQuestion = questions[currentIndex];

  return (
    <div className="min-h-screen bg-background">
      {/* 切屏警告浮层 */}
      {showSwitchWarning && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white text-center py-3 text-sm font-medium animate-in slide-in-from-top">
          {showSwitchWarning}
        </div>
      )}

      {/* 顶部工具栏 */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-2 max-w-7xl mx-auto">
          <h1 className="text-base font-semibold truncate max-w-xs">
            {examData.title}
          </h1>
          <div className="flex items-center gap-3">
            <SwitchCounter
              switchCount={switchCount}
              maxSwitchCount={examData.max_switch_count}
            />
            <CountdownTimer
              startedAt={examData.started_at}
              durationMinutes={examData.duration_minutes}
              endTime={examData.end_time}
              onTimeUp={handleTimeUp}
            />
            <Button
              size="sm"
              variant="destructive"
              className="gap-1.5"
              onClick={() => setShowSubmitDialog(true)}
            >
              <Send size={14} />
              交卷
            </Button>
          </div>
        </div>
      </header>

      {/* 主体区域 */}
      <div className="max-w-7xl mx-auto px-4 py-6 flex gap-6">
        {/* 左侧题目导航 */}
        <aside className="w-56 shrink-0 hidden lg:block">
          <div className="sticky top-20">
            <QuestionNav
              questions={questions}
              answers={answers}
              currentIndex={currentIndex}
              onNavigate={setCurrentIndex}
            />
          </div>
        </aside>

        {/* 右侧答题区 */}
        <main className="flex-1 min-w-0">
          {/* 显示模式切换 */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted-foreground">
              {currentIndex + 1} / {questions.length}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? <List size={14} /> : <LayoutGrid size={14} />}
              {showAll ? "单题模式" : "全部显示"}
            </Button>
          </div>

          {showAll ? (
            /* 全部题目模式 */
            <div className="space-y-8">
              {questions.map((q, i) => (
                <div key={q.question_id} className="border rounded-lg p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xs bg-muted px-2 py-0.5 rounded font-medium">
                      第 {i + 1} 题
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {q.score} 分
                    </span>
                  </div>
                  <QuestionRenderer
                    question={q}
                    answer={answers[q.question_id] ?? {}}
                    onChange={(ans) => updateAnswer(q.question_id, ans)}
                  />
                </div>
              ))}
            </div>
          ) : (
            /* 单题模式 */
            currentQuestion && (
              <div className="border rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-xs bg-muted px-2 py-0.5 rounded font-medium">
                    第 {currentIndex + 1} 题
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {currentQuestion.score} 分
                  </span>
                </div>
                <QuestionRenderer
                  question={currentQuestion}
                  answer={answers[currentQuestion.question_id] ?? {}}
                  onChange={(ans) =>
                    updateAnswer(currentQuestion.question_id, ans)
                  }
                />
                {/* 上一题/下一题 */}
                <div className="flex justify-between mt-6 pt-4 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentIndex === 0}
                    onClick={() => setCurrentIndex(currentIndex - 1)}
                    className="gap-1"
                  >
                    <ChevronLeft size={14} /> 上一题
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentIndex === questions.length - 1}
                    onClick={() => setCurrentIndex(currentIndex + 1)}
                    className="gap-1"
                  >
                    下一题 <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )
          )}
        </main>
      </div>

      {/* 提交确认弹窗 */}
      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认交卷？</AlertDialogTitle>
            <AlertDialogDescription>
              已答 {Object.values(answers).filter((a) =>
                Object.values(a).some((v) =>
                  Array.isArray(v) ? v.length > 0 && v.some(Boolean) : v !== "" && v !== null && v !== undefined
                )
              ).length} / {questions.length} 题。
              提交后将无法修改答案。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续答题</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit}>
              确认交卷
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

---

### Task 12: 更新路由与考试列表

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/student/my-exams.tsx`

- [ ] **Step 1: 在 App.tsx 添加考试答题路由**

在 App.tsx 的 Routes 中添加：
- `import { ExamTaking } from "./pages/student/exam-taking";`
- 在 `<Route path="/my-exams" ...>` 下方添加独立路由（无 Layout 包裹）：

```tsx
{/* 考试答题页面 - 独立布局，无侧边栏 */}
<Route
  path="/my-exams/:id/take"
  element={
    <Authenticated key="exam-taking" fallback={<CatchAllNavigate to="/login" />}>
      <ExamTaking />
    </Authenticated>
  }
/>
```

注意：此路由放在 Layout Route 之外，因为考试页面需要全屏布局。

- [ ] **Step 2: 重构 MyExams 页面**

更新 `frontend/src/pages/student/my-exams.tsx`：
- 使用学生专属 API `/api/student/exams`
- 改用"未参加"和"已参加"两个标签
- 点击"未参加"卡片时弹出考试须知弹窗
- 集成 `ExamNoticeDialog`

核心修改点：
1. 将 filter 从 `ongoing/upcoming/completed` 改为 `not_participated/participated`
2. 使用 `IMyExam` 类型（含 `participated` 字段）
3. 添加 `ExamNoticeDialog` 弹窗逻辑
4. 卡片上使用 Tag 区分"未参加"和"已参加"

- [ ] **Step 3: Commit integration**

```bash
git add frontend/src/App.tsx frontend/src/pages/student/
git commit -m "feat: add exam taking page, notice dialog, and update my-exams routing"
```

---

## Phase 6: Verification & Polish

### Task 13: 端到端验证

- [ ] **Step 1: 启动后端，验证 API**

```bash
cd /Users/jzefan/work/proj/exam/backend
python -m uvicorn app.main:app --reload --port 8000
```

验证端点：
- `GET /api/student/exams` → 200, 返回学生考试列表
- `POST /api/student/exams/{id}/start` → 200, 返回考试题目
- `POST /api/student/exams/{id}/answers` → 200, 保存答案
- `POST /api/student/exams/{id}/switch` → 200, 上报切屏
- `POST /api/student/exams/{id}/submit` → 200, 提交考试

- [ ] **Step 2: 启动前端，验证页面**

```bash
cd /Users/jzefan/work/proj/exam/frontend
npm run dev
```

验证流程：
1. 学生登录 → 进入 /my-exams
2. 看到考试列表，区分"未参加"/"已参加"
3. 点击"未参加"考试 → 弹出须知弹窗
4. 确认进入 → 显示考试答题页
5. 验证倒计时、题目导航、各题型答题
6. 切换窗口 → 切屏次数增加
7. 点击交卷 → 确认弹窗 → 提交成功

- [ ] **Step 3: 验证边界情况**

- 已提交考试不能重新进入
- 考试未开始时不能进入
- 切屏达上限自动提交
- 时间到自动提交
- 答案自动保存（30秒）
- 刷新页面恢复已保存答案

- [ ] **Step 4: Final commit**

```bash
git add frontend/src/ backend/src/
git commit -m "feat: complete student exam taking feature"
```

---

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| `RichTextEditor` 组件接口可能与预期不一致 | 先读取现有组件 API，适配 `content`/`onChange` 接口 |
| 文件上传 API 接口格式不确定 | 检查现有 `/api/uploads` 返回格式 |
| `useCustomMutation` 在 Refine 中的用法 | 参考现有代码中的用法，可能需要适配 data provider |
| 考试并发提交（双击交卷） | 前端 `submitted` 状态锁 + 后端幂等检查（`submitted_at is not None`） |
| 浏览器 `visibilitychange` 兼容性 | 主流浏览器均支持，无需 polyfill |
