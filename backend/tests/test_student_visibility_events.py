"""Tests for server-authoritative visibility event counting (≥3000ms threshold)."""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamAttemptState, ExamQuestion, ExamStudent
from app.questions.models import Question, QuestionType


async def _make_setup(db_session, *, max_switch_count=5, username_suffix=""):
    suffix = username_suffix or str(id(db_session))
    teacher = await create_user(
        db_session,
        UserCreate(
            username=f"teacher_vis_{suffix}",
            email=f"teacher_vis_{suffix}@example.com",
            password="pass123",
            full_name="Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username=f"student_vis_{suffix}",
            email=f"student_vis_{suffix}@example.com",
            password="pass123",
            full_name="Student",
            role_name="student",
        ),
    )
    question = Question(
        type=QuestionType.CHOICE,
        title="Q",
        content={"text": "Q?"},
        options={"A": "Yes", "B": "No"},
        answer={"correct": "A"},
        analysis="",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    now = datetime.now(timezone.utc)
    exam = Exam(
        title="Visibility test",
        description="",
        start_time=now - timedelta(minutes=10),
        end_time=now + timedelta(minutes=50),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=max_switch_count,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            ExamStudent(
                exam_id=exam.id,
                student_id=student.id,
                attempt_state=ExamAttemptState.IN_PROGRESS.value,
                started_at=now - timedelta(minutes=5),
            ),
        ]
    )
    await db_session.commit()
    return exam, student


@pytest.mark.asyncio
async def test_hide_show_pair_ge_3000ms_counts_as_switch(
    client: AsyncClient, db_session
) -> None:
    exam, student = await _make_setup(db_session, username_suffix="a")
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    t0 = 1_000_000
    r = await client.post(
        f"/api/student/exams/{exam.id}/visibility-events",
        json={
            "events": [
                {"hidden": True, "at_ms": t0},
                {"hidden": False, "at_ms": t0 + 4000},  # 4s gap → counts
            ]
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["switch_count"] == 1
    assert data["max_switch_count"] == 5


@pytest.mark.asyncio
async def test_hide_show_pair_lt_3000ms_does_not_count(
    client: AsyncClient, db_session
) -> None:
    exam, student = await _make_setup(db_session, username_suffix="b")
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    t0 = 2_000_000
    r = await client.post(
        f"/api/student/exams/{exam.id}/visibility-events",
        json={
            "events": [
                {"hidden": True, "at_ms": t0},
                {"hidden": False, "at_ms": t0 + 2999},  # just under 3s
            ]
        },
    )
    assert r.status_code == 200
    assert r.json()["switch_count"] == 0


@pytest.mark.asyncio
async def test_multiple_switch_pairs_counted_correctly(
    client: AsyncClient, db_session
) -> None:
    exam, student = await _make_setup(db_session, username_suffix="c")
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    t0 = 3_000_000
    events = [
        {"hidden": True, "at_ms": t0},
        {"hidden": False, "at_ms": t0 + 5000},   # +5s → counts
        {"hidden": True, "at_ms": t0 + 6000},
        {"hidden": False, "at_ms": t0 + 7000},   # +1s → does NOT count
        {"hidden": True, "at_ms": t0 + 8000},
        {"hidden": False, "at_ms": t0 + 12000},  # +4s → counts
    ]
    r = await client.post(
        f"/api/student/exams/{exam.id}/visibility-events",
        json={"events": events},
    )
    assert r.status_code == 200
    assert r.json()["switch_count"] == 2


@pytest.mark.asyncio
async def test_switch_count_accumulates_across_calls(
    client: AsyncClient, db_session
) -> None:
    exam, student = await _make_setup(db_session, username_suffix="d")
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    t0 = 4_000_000
    await client.post(
        f"/api/student/exams/{exam.id}/visibility-events",
        json={"events": [{"hidden": True, "at_ms": t0}, {"hidden": False, "at_ms": t0 + 4000}]},
    )
    r = await client.post(
        f"/api/student/exams/{exam.id}/visibility-events",
        json={"events": [{"hidden": True, "at_ms": t0 + 10000}, {"hidden": False, "at_ms": t0 + 15000}]},
    )
    assert r.status_code == 200
    assert r.json()["switch_count"] == 2


@pytest.mark.asyncio
async def test_empty_events_returns_current_count(
    client: AsyncClient, db_session
) -> None:
    exam, student = await _make_setup(db_session, username_suffix="e")
    token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {token}"})

    r = await client.post(
        f"/api/student/exams/{exam.id}/visibility-events",
        json={"events": []},
    )
    assert r.status_code == 200
    assert r.json()["switch_count"] == 0
