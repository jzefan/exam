import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.learning.models import KnowledgePoint
from app.questions.models import (
    Question,
    QuestionBank,
    QuestionImportJob,
    QuestionSource,
    QuestionType,
)
from app.questions.schemas import QuestionCreate
from app.questions.service import (
    _set_question_matched_course_knowledge_points,
    root_knowledge_question_bank_name,
)
from app.rbac.models import Organization, Role


async def _create_teacher(
    db_session, *, username: str = "knowledge-completion-teacher"
):
    org = Organization(name=f"{username}-org", type="school", is_active=True)
    role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, role])
    await db_session.flush()
    teacher = await create_user(
        db_session,
        UserCreate(
            username=username,
            email=f"{username}@example.com",
            password="teacherpass123",
            full_name="Knowledge Completion Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    return teacher


def _question_create(question: Question) -> QuestionCreate:
    return QuestionCreate(
        type=question.type,
        title=question.title,
        content=question.content,
        options=question.options,
        answer=question.answer,
        analysis=question.analysis,
        difficulty=question.difficulty,
        score=question.score,
        source=QuestionSource.IMPORTED,
        tag_ids=[],
        knowledge_point_ids=[kp.id for kp in question.knowledge_points],
        question_bank_id=question.question_bank_id,
    )


@pytest.mark.asyncio
async def test_course_knowledge_match_replaces_root_with_matched_child(
    db_session, monkeypatch
) -> None:
    teacher = await _create_teacher(db_session)
    root = KnowledgePoint(
        name="数据库课程", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE
    )
    bank = QuestionBank(
        name="数据库课程-题库", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE
    )
    db_session.add_all([root, bank])
    await db_session.flush()
    child = KnowledgePoint(
        name="事务隔离级别",
        parent_id=root.id,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    question = Question(
        type=QuestionType.CHOICE,
        title="事务隔离级别",
        content={"text": "MySQL 默认隔离级别是什么？"},
        options={"A": "READ COMMITTED", "B": "REPEATABLE READ"},
        answer={"correct": "B"},
        analysis=None,
        difficulty=3,
        score=10,
        source=QuestionSource.IMPORTED,
        owner_id=teacher.id,
        created_by=teacher.id,
        question_bank=bank,
        knowledge_points=[root],
    )
    db_session.add_all([child, question])
    await db_session.flush()

    async def fake_match(*_args, **_kwargs):
        return [child.id]

    monkeypatch.setattr("app.questions.service.match_knowledge_points_with_ai", fake_match)

    matched = await _set_question_matched_course_knowledge_points(
        db_session,
        question=question,
        question_data=_question_create(question),
        candidates=[child],
        root_knowledge_point_id=root.id,
    )

    assert matched is True
    assert {kp.id for kp in question.knowledge_points} == {child.id}


@pytest.mark.asyncio
async def test_course_knowledge_match_does_not_fallback_to_root(
    db_session, monkeypatch
) -> None:
    teacher = await _create_teacher(
        db_session, username="knowledge-completion-unmatched"
    )
    root = KnowledgePoint(
        name="程序设计课程", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE
    )
    bank = QuestionBank(
        name="程序设计课程-题库", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE
    )
    db_session.add_all([root, bank])
    await db_session.flush()
    child = KnowledgePoint(
        name="循环结构",
        parent_id=root.id,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    question = Question(
        type=QuestionType.CHOICE,
        title="未匹配题",
        content={"text": "这道题暂时无法归类。"},
        options={"A": "A", "B": "B"},
        answer={"correct": "A"},
        analysis=None,
        difficulty=3,
        score=10,
        source=QuestionSource.IMPORTED,
        owner_id=teacher.id,
        created_by=teacher.id,
        question_bank=bank,
        knowledge_points=[root],
    )
    db_session.add_all([child, question])
    await db_session.flush()

    async def fake_match(*_args, **_kwargs):
        return []

    monkeypatch.setattr("app.questions.service.match_knowledge_points_with_ai", fake_match)

    matched = await _set_question_matched_course_knowledge_points(
        db_session,
        question=question,
        question_data=_question_create(question),
        candidates=[child],
        root_knowledge_point_id=root.id,
    )

    assert matched is False
    assert question.knowledge_points == []


@pytest.mark.asyncio
async def test_course_complete_knowledge_endpoint_defaults_to_all_questions(
    client: AsyncClient,
    db_session,
    monkeypatch,
) -> None:
    teacher = await _create_teacher(db_session, username="knowledge-completion-api")
    course = KnowledgePoint(name="操作系统", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    bank = QuestionBank(
        name=root_knowledge_question_bank_name("操作系统"),
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    q1 = Question(
        type=QuestionType.CHOICE,
        title="进程状态",
        content={"text": "进程的基本状态有哪些？"},
        options={"A": "就绪", "B": "阻塞"},
        answer={"correct": "A"},
        analysis=None,
        difficulty=3,
        score=10,
        source=QuestionSource.IMPORTED,
        owner_id=teacher.id,
        created_by=teacher.id,
        question_bank=bank,
    )
    q2 = Question(
        type=QuestionType.CHOICE,
        title="页面置换",
        content={"text": "LRU 属于什么算法？"},
        options={"A": "页面置换", "B": "调度"},
        answer={"correct": "A"},
        analysis=None,
        difficulty=3,
        score=10,
        source=QuestionSource.IMPORTED,
        owner_id=teacher.id,
        created_by=teacher.id,
        question_bank=bank,
    )
    db_session.add_all([course, bank, q1, q2])
    await db_session.commit()

    async def noop_background_task(**_kwargs):
        return None

    monkeypatch.setattr(
        "app.teacher_courses.router.process_existing_question_knowledge_match_job",
        noop_background_task,
    )

    client.headers.update(
        {"Authorization": f"Bearer {create_access_token(teacher.id, '')}"}
    )
    response = await client.post(
        f"/api/teacher/courses/{course.id}/questions/complete-knowledge",
        json={"question_ids": []},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["total_count"] == 2
    assert set(payload["question_ids"]) == {str(q1.id), str(q2.id)}

    job = (
        await db_session.execute(
            select(QuestionImportJob).where(
                QuestionImportJob.id == uuid.UUID(payload["job_id"])
            )
        )
    ).scalar_one()
    assert job.total_count == 2
    assert set(job.created_question_ids) == {str(q1.id), str(q2.id)}
