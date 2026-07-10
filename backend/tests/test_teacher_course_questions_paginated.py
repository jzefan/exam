import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.learning.models import KnowledgePoint
from app.questions.models import (
    Question,
    QuestionBank,
    QuestionSource,
    QuestionType,
)
from app.questions.service import root_knowledge_question_bank_name
from app.rbac.models import Organization, Role


async def _create_teacher(db_session, *, username: str) -> object:
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
            full_name="Paginated Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    return teacher


def _make_question(teacher, bank, type_: QuestionType, title: str, kps):
    is_choice = type_ in (QuestionType.CHOICE, QuestionType.TRUE_FALSE)
    return Question(
        type=type_,
        title=title,
        content={"text": title},
        options={"A": "a", "B": "b"} if is_choice else None,
        answer={"correct": "A"} if is_choice else {"text": "x"},
        analysis=None,
        difficulty=2,
        score=10,
        source=QuestionSource.IMPORTED,
        owner_id=teacher.id,
        created_by=teacher.id,
        question_bank=bank,
        knowledge_points=list(kps),
    )


def _auth(client, teacher) -> None:
    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})


@pytest.mark.asyncio
async def test_paginated_returns_page_and_total(client: AsyncClient, db_session) -> None:
    teacher = await _create_teacher(db_session, username="paginated-teacher")
    course = KnowledgePoint(name="分页课程", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    bank = QuestionBank(
        name=root_knowledge_question_bank_name("分页课程"),
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([course, bank])
    await db_session.flush()
    db_session.add_all(
        [_make_question(teacher, bank, QuestionType.CHOICE, f"Q{i}", [course]) for i in range(12)]
    )
    await db_session.commit()
    _auth(client, teacher)

    resp = await client.get(
        f"/api/teacher/courses/{course.id}/questions/paginated?page=1&page_size=5"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 12
    assert len(data["items"]) == 5

    resp = await client.get(
        f"/api/teacher/courses/{course.id}/questions/paginated?page=3&page_size=5"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 12
    assert len(data["items"]) == 2


@pytest.mark.asyncio
async def test_type_counts_ignore_types_filter(client: AsyncClient, db_session) -> None:
    teacher = await _create_teacher(db_session, username="paginated-types")
    course = KnowledgePoint(name="题型课程", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    bank = QuestionBank(
        name=root_knowledge_question_bank_name("题型课程"),
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([course, bank])
    await db_session.flush()
    db_session.add_all(
        [
            _make_question(teacher, bank, QuestionType.CHOICE, "c1", [course]),
            _make_question(teacher, bank, QuestionType.CHOICE, "c2", [course]),
            _make_question(teacher, bank, QuestionType.FILL_IN, "f1", [course]),
            _make_question(teacher, bank, QuestionType.SHORT_ANSWER, "s1", [course]),
        ]
    )
    await db_session.commit()
    _auth(client, teacher)

    resp = await client.get(
        f"/api/teacher/courses/{course.id}/questions/paginated?types=choice"
    )
    assert resp.status_code == 200
    data = resp.json()
    # type_counts must include every type, ignoring the `types` filter.
    assert data["type_counts"].get("choice") == 2
    assert data["type_counts"].get("fill_in") == 1
    assert data["type_counts"].get("short_answer") == 1
    # items should be limited to the requested type.
    assert data["total"] == 2
    assert all(item["type"] == "choice" for item in data["items"])


@pytest.mark.asyncio
async def test_kp_filter_returns_full_page_with_multi_kp(client: AsyncClient, db_session) -> None:
    """A question linked to multiple knowledge points must not shrink the page.

    Before the distinct-ID subquery fix, joining question_knowledge_points
    multiplied rows per KP and .limit(page_size) was applied before dedup,
    so a page could return fewer items than requested.
    """
    teacher = await _create_teacher(db_session, username="paginated-multikp")
    root = KnowledgePoint(name="多知识点课程", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    child = KnowledgePoint(
        name="子知识点", parent_id=root.id, owner_id=teacher.id, visibility=VisibilityScope.PRIVATE
    )
    bank = QuestionBank(
        name=root_knowledge_question_bank_name("多知识点课程"),
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([root, child, bank])
    await db_session.flush()
    db_session.add_all(
        [_make_question(teacher, bank, QuestionType.CHOICE, f"M{i}", [root, child]) for i in range(5)]
    )
    await db_session.commit()
    _auth(client, teacher)

    resp = await client.get(
        f"/api/teacher/courses/{root.id}/questions/paginated"
        f"?page=1&page_size=5&knowledge_point_id={root.id}"
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
    assert len(data["items"]) == 5


@pytest.mark.asyncio
async def test_search_filter_and_timing(client: AsyncClient, db_session) -> None:
    import time

    teacher = await _create_teacher(db_session, username="paginated-search")
    course = KnowledgePoint(name="搜索课程", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    bank = QuestionBank(
        name=root_knowledge_question_bank_name("搜索课程"),
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([course, bank])
    await db_session.flush()
    db_session.add_all(
        [
            _make_question(teacher, bank, QuestionType.CHOICE, "唯一关键字题目", [course]),
            _make_question(teacher, bank, QuestionType.CHOICE, "普通题目", [course]),
        ]
    )
    await db_session.commit()
    _auth(client, teacher)

    start = time.perf_counter()
    resp = await client.get(
        f"/api/teacher/courses/{course.id}/questions/paginated?q=唯一关键字"
    )
    elapsed = time.perf_counter() - start
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["title"] == "唯一关键字题目"
    # Sanity check: small dataset must respond well under budget.
    assert elapsed < 1.0
