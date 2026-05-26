"""Tests for the activity-log helper, list endpoint, and admin-only access."""

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.activity_logs.models import ActivityLog
from app.activity_logs.service import (
    CATEGORY_AUTH,
    CATEGORY_EXAM,
    CATEGORY_QUESTION,
    list_activity_logs,
    log_event,
)
from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Organization, Role


async def _seed_roles(db_session) -> Organization:
    org = Organization(name="Activity Org", type="school", is_active=True)
    db_session.add_all(
        [
            org,
            Role(name="platform_admin", display_name="Platform Admin", is_system=True),
            Role(name="teacher", display_name="Teacher", is_system=True),
            Role(name="student", display_name="Student", is_system=True),
        ]
    )
    await db_session.flush()
    return org


@pytest.mark.asyncio
async def test_log_event_writes_row_with_user_role_and_metadata(db_session) -> None:
    org = await _seed_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="al-teacher",
            email="al-teacher@example.com",
            password="pass1234",
            full_name="AL Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )

    await log_event(
        db_session,
        event_category=CATEGORY_QUESTION,
        event_type="question_create",
        user=teacher,
        target_type="question",
        target_id="00000000-0000-0000-0000-000000000abc",
        metadata={"title": "T1", "question_type": "choice"},
    )
    await db_session.commit()

    row = (await db_session.execute(select(ActivityLog))).scalars().one()
    assert row.user_id == teacher.id
    assert row.username == "al-teacher"
    assert row.full_name == "AL Teacher"
    assert row.role_name == "teacher"
    assert row.event_category == CATEGORY_QUESTION
    assert row.event_type == "question_create"
    assert row.target_type == "question"
    assert row.target_id == "00000000-0000-0000-0000-000000000abc"
    assert row.event_metadata == {"title": "T1", "question_type": "choice"}
    assert row.success is True


@pytest.mark.asyncio
async def test_log_event_supports_failed_login_with_no_user(db_session) -> None:
    await _seed_roles(db_session)
    await log_event(
        db_session,
        event_category=CATEGORY_AUTH,
        event_type="login",
        username="ghost",
        success=False,
        metadata={"reason": "user_not_found"},
    )
    await db_session.commit()

    row = (await db_session.execute(select(ActivityLog))).scalars().one()
    assert row.user_id is None
    assert row.username == "ghost"
    assert row.success is False
    assert row.event_metadata == {"reason": "user_not_found"}


@pytest.mark.asyncio
async def test_list_activity_logs_filters_by_role_and_type_and_date(db_session) -> None:
    org = await _seed_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="al-teacher2",
            email="al-teacher2@example.com",
            password="pass1234",
            full_name="T2",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="al-student2",
            email="al-student2@example.com",
            password="pass1234",
            full_name="S2",
            role_name="student",
            org_id=org.id,
        ),
    )

    await log_event(
        db_session,
        event_category=CATEGORY_EXAM,
        event_type="exam_start",
        user=student,
    )
    await log_event(
        db_session,
        event_category=CATEGORY_EXAM,
        event_type="exam_submit",
        user=student,
    )
    await log_event(
        db_session,
        event_category=CATEGORY_QUESTION,
        event_type="question_create",
        user=teacher,
    )
    await db_session.commit()

    rows, total = await list_activity_logs(db_session, role_name="student")
    assert total == 2
    assert {r.event_type for r in rows} == {"exam_start", "exam_submit"}

    rows, total = await list_activity_logs(db_session, event_type="question_create")
    assert total == 1
    assert rows[0].user_id == teacher.id

    rows, total = await list_activity_logs(
        db_session,
        event_category=CATEGORY_EXAM,
        date_from=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    assert total == 2

    rows, total = await list_activity_logs(
        db_session,
        date_from=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    assert total == 0


@pytest.mark.asyncio
async def test_list_activity_logs_user_search_matches_username_or_full_name(db_session) -> None:
    org = await _seed_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="al-jdoe",
            email="al-jdoe@example.com",
            password="pass1234",
            full_name="Jane Doe",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    await log_event(
        db_session,
        event_category=CATEGORY_AUTH,
        event_type="login",
        user=teacher,
    )
    await log_event(
        db_session,
        event_category=CATEGORY_AUTH,
        event_type="login",
        username="anonymous",
        success=False,
    )
    await db_session.commit()

    rows, total = await list_activity_logs(db_session, user_search="jdoe")
    assert total == 1
    assert rows[0].username == "al-jdoe"

    rows, total = await list_activity_logs(db_session, user_search="Jane")
    assert total == 1
    assert rows[0].full_name == "Jane Doe"


@pytest.mark.asyncio
async def test_activity_logs_endpoint_requires_platform_admin(
    client: AsyncClient, db_session
) -> None:
    org = await _seed_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="al-teacher3",
            email="al-teacher3@example.com",
            password="pass1234",
            full_name="T3",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    admin = await create_user(
        db_session,
        UserCreate(
            username="al-admin",
            email="al-admin@example.com",
            password="pass1234",
            full_name="Admin",
            role_name="platform_admin",
            org_id=org.id,
        ),
    )

    await db_session.commit()
    teacher_token = create_access_token(teacher.id, "")
    admin_token = create_access_token(admin.id, "")

    resp = await client.get(
        "/api/operations/activity-logs",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "items" in body
    assert "total" in body
    assert body["page"] == 1
    assert body["page_size"] == 20

    resp = await client.get(
        "/api/operations/activity-logs",
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_activity_logs_endpoint_returns_filtered_results(
    client: AsyncClient, db_session
) -> None:
    org = await _seed_roles(db_session)
    admin = await create_user(
        db_session,
        UserCreate(
            username="al-admin2",
            email="al-admin2@example.com",
            password="pass1234",
            full_name="Admin2",
            role_name="platform_admin",
            org_id=org.id,
        ),
    )
    teacher = await create_user(
        db_session,
        UserCreate(
            username="al-teacher4",
            email="al-teacher4@example.com",
            password="pass1234",
            full_name="T4",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    await log_event(
        db_session,
        event_category=CATEGORY_QUESTION,
        event_type="question_create",
        user=teacher,
    )
    await log_event(
        db_session,
        event_category=CATEGORY_AUTH,
        event_type="login",
        user=teacher,
    )
    await db_session.commit()

    token = create_access_token(admin.id, "")
    resp = await client.get(
        "/api/operations/activity-logs?event_category=question",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["event_type"] == "question_create"
    assert body["items"][0]["role_name"] == "teacher"
