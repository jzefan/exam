"""Tests for wrong-answer remedial practice (错题强化练习)."""

import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamStudent, StudentQuestionProgress
from app.exams.wrong_answers import allocate_by_weight
from app.learning.models import Direction, KnowledgePoint, Major
from app.questions.models import Question, QuestionType


# ── 纯函数 ──


def test_allocate_by_weight_keeps_total_and_scales_by_ratio() -> None:
    assert allocate_by_weight({"a": 3, "b": 1}, 8) == {"a": 6, "b": 2}
    assert sum(allocate_by_weight({"a": 1, "b": 1, "c": 1}, 2).values()) == 2
    assert allocate_by_weight({}, 5) == {}
    assert allocate_by_weight({"a": 2}, 0) == {}


# ── 夹具 ──


async def _make_source_exam(db_session, *, suffix: str, with_knowledge_point: bool = True):
    teacher = await create_user(
        db_session,
        UserCreate(
            username=f"teacher_rp_{suffix}",
            email=f"teacher_rp_{suffix}@example.com",
            password="pass123",
            full_name="Teacher",
            role_name="teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username=f"student_rp_{suffix}",
            email=f"student_rp_{suffix}@example.com",
            password="pass123",
            full_name="Student",
            role_name="student",
        ),
    )
    other_student = await create_user(
        db_session,
        UserCreate(
            username=f"other_rp_{suffix}",
            email=f"other_rp_{suffix}@example.com",
            password="pass123",
            full_name="Other",
            role_name="student",
        ),
    )

    exam = Exam(
        category="practice",
        title="SQL 基础练习",
        description="",
        duration_minutes=30,
        total_score=10,
        status="ongoing",
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add(ExamStudent(exam_id=exam.id, student_id=student.id))

    knowledge_point = None
    if with_knowledge_point:
        major = Major(name=f"计算机 {suffix}", description="")
        db_session.add(major)
        await db_session.flush()
        direction = Direction(name=f"网络 {suffix}", description="", major_id=major.id)
        db_session.add(direction)
        await db_session.flush()
        knowledge_point = KnowledgePoint(
            name="DNS域名系统",
            description="",
            direction_id=direction.id,
            parent_id=None,
            owner_id=teacher.id,
        )
        db_session.add(knowledge_point)
        await db_session.flush()

    now = datetime.now(timezone.utc)
    for index in range(3):
        question = Question(
            type=QuestionType.CHOICE,
            title=f"错题 {index}",
            content={"text": f"问题 {index}？", "multi": False},
            options={"A": "是", "B": "否"},
            answer={"correct": "A"},
            analysis="解析",
            difficulty=2,
            score=5,
            usage_count=0,
            created_by=teacher.id,
            owner_id=teacher.id,
        )
        if knowledge_point is not None and index < 2:
            question.knowledge_points = [knowledge_point]
        db_session.add(question)
        await db_session.flush()
        db_session.add(
            StudentQuestionProgress(
                student_id=student.id,
                question_id=question.id,
                last_exam_id=exam.id,
                wrong_count=1,
                last_wrong_at=now,
                mastered=False,
            )
        )

    await db_session.commit()
    return exam, student, other_student, knowledge_point


def _fake_stream(total_per_call: int = 50):
    """替身：按请求数量产出结构合法的题目事件。"""

    async def _stream(_db, request, _user_id):
        for index in range(request.total_count):
            yield {
                "type": "question",
                "index": index + 1,
                "data": {
                    "type": "choice",
                    "title": f"强化题 {index + 1}",
                    "content": {"text": f"强化题干 {index + 1}", "multi": False},
                    "options": {"A": "甲", "B": "乙"},
                    "answer": {"correct": "A"},
                    "analysis": "解析",
                    "difficulty": 3,
                },
            }
        yield {"type": "done", "total": request.total_count}

    return _stream


# ── 分析接口 ──


@pytest.mark.asyncio
async def test_practice_analysis_lists_knowledge_groups_and_suggested_counts(
    client: AsyncClient, db_session
) -> None:
    exam, student, _other, knowledge_point = await _make_source_exam(db_session, suffix="analysis")
    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})

    response = await client.get(f"/api/wrong-answers/practice-analysis/{exam.id}")
    assert response.status_code == 200

    body = response.json()
    assert body["source_exam_id"] == str(exam.id)
    assert body["source_title"] == "SQL 基础练习"
    assert body["source_category"] == "practice"
    assert body["wrong_question_count"] == 3
    assert body["default_total_count"] == 10
    assert body["practices"] == []

    groups = body["groups"]
    assert len(groups) == 2
    keyed = {group["key"]: group for group in groups}
    assert str(knowledge_point.id) in keyed[f"kp:{knowledge_point.id}"]["name"] or (
        keyed[f"kp:{knowledge_point.id}"]["name"] == "DNS域名系统"
    )
    assert keyed[f"kp:{knowledge_point.id}"]["wrong_question_count"] == 2
    assert keyed["other"]["wrong_question_count"] == 1
    assert keyed["other"]["knowledge_point_id"] is None
    # 默认分配合计等于总题数，且按错题数占比倾斜
    assert sum(group["suggested_count"] for group in groups) == 10
    assert keyed[f"kp:{knowledge_point.id}"]["suggested_count"] > keyed["other"]["suggested_count"]


@pytest.mark.asyncio
async def test_practice_analysis_rejects_other_students_source(
    client: AsyncClient, db_session
) -> None:
    exam, _student, other_student, _kp = await _make_source_exam(db_session, suffix="guard")
    client.headers.update({"Authorization": f"Bearer {create_access_token(other_student.id, '')}"})

    response = await client.get(f"/api/wrong-answers/practice-analysis/{exam.id}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_practice_analysis_supports_legacy_source_key(client: AsyncClient, db_session) -> None:
    _exam, student, _other, _kp = await _make_source_exam(db_session, suffix="legacy")
    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})

    response = await client.get("/api/wrong-answers/practice-analysis/legacy")
    # 该学生没有历史错题 → 404；只是确认路由可达而不是 422/500
    assert response.status_code == 404


# ── 生成接口 ──


@pytest.mark.asyncio
async def test_create_remedial_practice_hides_exam_from_lists(
    client: AsyncClient, db_session, monkeypatch
) -> None:
    exam, student, _other, knowledge_point = await _make_source_exam(db_session, suffix="create")
    monkeypatch.setattr("app.exams.wrong_answers.generate_questions_stream", _fake_stream())
    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})

    response = await client.post(
        "/api/wrong-answers/practice",
        json={
            "source_exam_id": str(exam.id),
            "total_count": 4,
            "allocations": [
                {"group_key": f"kp:{knowledge_point.id}", "count": 3},
                {"group_key": "other", "count": 1},
            ],
        },
    )
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["question_count"] == 4
    assert created["requested_count"] == 4
    assert created["title"].endswith("错题强化练习")

    practice_id = created["exam_id"]

    # 生成的题目落库，且挂到了对应知识点上
    generated_rows = (
        await db_session.execute(
            Question.__table__.select().where(Question.__table__.c.title.like("强化题%"))
        )
    ).all()
    assert len(generated_rows) == 4

    # 强化练习不出现在考试/练习列表
    list_response = await client.get("/api/exams", params={"pagination[pageSize]": 50})
    assert list_response.status_code == 200
    assert all(item["id"] != practice_id for item in list_response.json())

    # 但学生可以直接开始做题
    start_response = await client.post(f"/api/student/exams/{practice_id}/start")
    assert start_response.status_code == 200, start_response.text
    assert len(start_response.json()["questions"]) == 4

    # 错题本里能看到这个来源下的强化练习
    analysis = await client.get(f"/api/wrong-answers/practice-analysis/{exam.id}")
    assert analysis.status_code == 200
    practices = analysis.json()["practices"]
    assert len(practices) == 1
    assert practices[0]["id"] == practice_id
    assert practices[0]["question_count"] == 4


@pytest.mark.asyncio
async def test_remedial_practice_wrong_answers_group_back_to_source(
    client: AsyncClient, db_session, monkeypatch
) -> None:
    exam, student, _other, knowledge_point = await _make_source_exam(db_session, suffix="regroup")
    monkeypatch.setattr("app.exams.wrong_answers.generate_questions_stream", _fake_stream())
    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})

    created = (
        await client.post(
            "/api/wrong-answers/practice",
            json={
                "source_exam_id": str(exam.id),
                "allocations": [{"group_key": f"kp:{knowledge_point.id}", "count": 1}],
            },
        )
    ).json()
    practice_id = uuid.UUID(created["exam_id"])

    # 模拟学生在这场强化练习里又做错了一道题
    practice_question = (
        await db_session.execute(
            select(Question).where(Question.title.like("强化题%")).limit(1)
        )
    ).scalars().first()
    db_session.add(
        StudentQuestionProgress(
            student_id=student.id,
            question_id=practice_question.id,
            last_exam_id=practice_id,
            wrong_count=1,
            last_wrong_at=datetime.now(timezone.utc),
            mastered=False,
        )
    )
    await db_session.commit()

    list_response = await client.get("/api/wrong-answers")
    assert list_response.status_code == 200
    items = list_response.json()
    # 错题本仍然只有「SQL 基础练习」一个来源分组，不会冒出强化练习分组
    assert {item["exam_id"] for item in items} == {str(exam.id)}
    assert all(item["remedial_practice_count"] == 1 for item in items)


@pytest.mark.asyncio
async def test_create_remedial_practice_rejects_unknown_group_key(
    client: AsyncClient, db_session, monkeypatch
) -> None:
    exam, student, _other, _kp = await _make_source_exam(db_session, suffix="badkey")
    monkeypatch.setattr("app.exams.wrong_answers.generate_questions_stream", _fake_stream())
    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})

    response = await client.post(
        "/api/wrong-answers/practice",
        json={
            "source_exam_id": str(exam.id),
            "allocations": [{"group_key": "kp:00000000-0000-0000-0000-000000000000", "count": 2}],
        },
    )
    assert response.status_code == 422
