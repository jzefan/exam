"""Tests for course short links, direct entry, workspace passwords, and multi-user data isolation."""

import uuid
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.models import User
from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.job_models.models import LearningResource
from app.learning.models import Direction, KnowledgePoint, Major
from app.papers.models import Paper
from app.questions.models import Question, QuestionBank, QuestionType
from app.questions.service import root_knowledge_question_bank_name
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.service import add_role_to_user


async def _create_teacher(
    db: AsyncSession,
    username: str,
    org: Organization,
    teacher_role: Role,
) -> tuple[User, str]:
    user = await create_user(
        db,
        UserCreate(
            username=username,
            email=f"{username}@example.com",
            password="password123",
            full_name=f"Teacher {username}",
        ),
    )
    user.primary_org_id = org.id
    await add_role_to_user(db, user.id, org.id, teacher_role.id, is_primary=True)
    await db.commit()
    token = create_access_token(user.id, "teacher")
    return user, token


@pytest.fixture
async def setup_course_env(db_session: AsyncSession):
    org = Organization(name="Test University", type="school", is_active=True)
    db_session.add(org)
    await db_session.flush()

    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add(teacher_role)
    await db_session.flush()

    major = Major(name="Computer Science")
    db_session.add(major)
    await db_session.flush()

    direction = Direction(name="Python Direction", major_id=major.id)
    db_session.add(direction)
    await db_session.flush()

    author, author_token = await _create_teacher(db_session, "author_teacher", org, teacher_role)
    other, other_token = await _create_teacher(db_session, "other_teacher", org, teacher_role)

    # Base Course Knowledge Point
    course = KnowledgePoint(
        name="Python Programming Course",
        direction_id=direction.id,
        owner_id=author.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(course)
    await db_session.flush()

    # Sub-knowledge point
    kp1 = KnowledgePoint(
        name="Variables and Types",
        parent_id=course.id,
        owner_id=author.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(kp1)
    await db_session.flush()

    # Course default question bank
    bank = QuestionBank(
        name=root_knowledge_question_bank_name(course.name),
        owner_id=author.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(bank)
    await db_session.flush()

    # Base question
    base_q = Question(
        type=QuestionType.CHOICE,
        title="What is type(42)?",
        content={"stem": "What is type(42)?"},
        options={"A": "int", "B": "str"},
        answer={"answer": "A"},
        difficulty=1,
        score=5.0,
        question_bank_id=bank.id,
        owner_id=author.id,
        created_by=author.id,
    )
    base_q.knowledge_points.append(kp1)
    db_session.add(base_q)
    await db_session.flush()

    # Base material
    base_mat = LearningResource(
        node_id=course.id,
        node_type="kp",
        resource_type="document",
        title="Course Syllabus",
        url="/api/uploads/syllabus.pdf",
        uploaded_by=author.id,
    )
    db_session.add(base_mat)
    await db_session.flush()

    # Base paper
    base_paper = Paper(
        title="Midterm Exam Paper",
        root_knowledge_point_id=course.id,
        owner_id=author.id,
        created_by=author.id,
        is_reusable=True,
    )
    db_session.add(base_paper)
    await db_session.commit()

    return {
        "org": org,
        "author": author,
        "author_token": author_token,
        "other": other,
        "other_token": other_token,
        "course": course,
        "kp1": kp1,
        "base_q": base_q,
        "base_mat": base_mat,
        "base_paper": base_paper,
    }


@pytest.mark.asyncio
async def test_course_publish_link_crud(client: AsyncClient, setup_course_env: dict):
    env = setup_course_env
    course_id = env["course"].id
    author_auth = {"Authorization": f"Bearer {env['author_token']}"}
    other_auth = {"Authorization": f"Bearer {env['other_token']}"}

    # 1. Other teacher cannot publish author's course
    resp = await client.post(f"/api/teacher/courses/{course_id}/publish-link", headers=other_auth)
    assert resp.status_code == 403

    # 2. Author creates publish link
    resp = await client.post(f"/api/teacher/courses/{course_id}/publish-link", headers=author_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["course_id"] == str(course_id)
    assert data["is_active"] is True
    assert "share_code" in data
    assert f"/c/{data['share_code']}" in data["share_url"]
    share_code = data["share_code"]

    # 3. Get publish link status
    resp = await client.get(f"/api/teacher/courses/{course_id}/publish-link", headers=author_auth)
    assert resp.status_code == 200
    assert resp.json()["share_code"] == share_code
    assert resp.json()["is_active"] is True

    # 4. Revoke publish link
    resp = await client.delete(f"/api/teacher/courses/{course_id}/publish-link", headers=author_auth)
    assert resp.status_code == 204

    # Now get returns null
    resp = await client.get(f"/api/teacher/courses/{course_id}/publish-link", headers=author_auth)
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio
async def test_course_share_public_preview_and_direct_entry(client: AsyncClient, setup_course_env: dict):
    env = setup_course_env
    course_id = env["course"].id
    author_auth = {"Authorization": f"Bearer {env['author_token']}"}

    # Author publishes link
    resp = await client.post(f"/api/teacher/courses/{course_id}/publish-link", headers=author_auth)
    share_code = resp.json()["share_code"]

    # Public preview without any token
    preview_resp = await client.get(f"/api/public/course-share/{share_code}")
    assert preview_resp.status_code == 200
    preview_data = preview_resp.json()
    assert preview_data["course_name"] == "Python Programming Course"
    assert preview_data["stats"]["knowledge_point_count"] == 1
    assert preview_data["stats"]["material_count"] == 1
    assert preview_data["stats"]["question_count"] == 1
    assert preview_data["stats"]["paper_count"] == 1

    # Direct Entry as a new visitor (no login required!)
    enter_resp = await client.post(
        f"/api/public/course-share/{share_code}/enter",
        json={"alias_name": "访客李老师"},
    )
    assert enter_resp.status_code == 200
    enter_data = enter_resp.json()
    assert enter_data["requires_password"] is False
    assert enter_data["course_id"] == str(course_id)
    assert enter_data["access_token"] is not None
    assert enter_data["workspace_key"] is not None
    guest_token = enter_data["access_token"]
    ws_key = enter_data["workspace_key"]

    # Use guest token to fetch course details directly
    guest_auth = {"Authorization": f"Bearer {guest_token}"}
    detail_resp = await client.get(f"/api/teacher/courses/{course_id}", headers=guest_auth)
    assert detail_resp.status_code == 200
    detail_data = detail_resp.json()
    assert detail_data["name"] == "Python Programming Course"
    assert detail_data["can_write"] is True  # Can write in workspace!
    assert detail_data["is_owner"] is False  # But not root course owner


@pytest.mark.asyncio
async def test_course_workspace_password_flow(client: AsyncClient, setup_course_env: dict):
    env = setup_course_env
    course_id = env["course"].id
    author_auth = {"Authorization": f"Bearer {env['author_token']}"}

    # Author publishes
    pub_resp = await client.post(f"/api/teacher/courses/{course_id}/publish-link", headers=author_auth)
    share_code = pub_resp.json()["share_code"]

    # 1. Visitor enters
    enter_resp = await client.post(
        f"/api/public/course-share/{share_code}/enter",
        json={"alias_name": "王老师"},
    )
    enter_data = enter_resp.json()
    guest_token = enter_data["access_token"]
    ws_key = enter_data["workspace_key"]
    guest_auth = {"Authorization": f"Bearer {guest_token}"}

    # 2. Check security initially: no password
    sec_resp = await client.get(f"/api/teacher/courses/{course_id}/workspace-security", headers=guest_auth)
    assert sec_resp.status_code == 200
    assert sec_resp.json()["has_password"] is False

    # 3. Set workspace password
    set_resp = await client.post(
        f"/api/teacher/courses/{course_id}/workspace-security/password",
        json={"password": "mypassword888"},
        headers=guest_auth,
    )
    assert set_resp.status_code == 200
    assert set_resp.json()["has_password"] is True

    # 4. Now visitor visits short link again with workspace_key but no password
    re_enter_no_pwd = await client.post(
        f"/api/public/course-share/{share_code}/enter",
        json={"workspace_key": ws_key},
    )
    assert re_enter_no_pwd.status_code == 200
    assert re_enter_no_pwd.json()["requires_password"] is True
    assert re_enter_no_pwd.json()["has_password"] is True

    # 5. Wrong password -> 401
    wrong_pwd = await client.post(
        f"/api/public/course-share/{share_code}/enter",
        json={"workspace_key": ws_key, "password": "wrongpassword"},
    )
    assert wrong_pwd.status_code == 401

    # 6. Correct password -> 200 with new token
    correct_pwd = await client.post(
        f"/api/public/course-share/{share_code}/enter",
        json={"workspace_key": ws_key, "password": "mypassword888"},
    )
    assert correct_pwd.status_code == 200
    assert correct_pwd.json()["access_token"] is not None
    assert correct_pwd.json()["requires_password"] is False


@pytest.mark.asyncio
async def test_user_data_isolation_and_shared_base_resources(
    client: AsyncClient, setup_course_env: dict, db_session: AsyncSession
):
    env = setup_course_env
    course_id = env["course"].id
    author_auth = {"Authorization": f"Bearer {env['author_token']}"}

    pub_resp = await client.post(f"/api/teacher/courses/{course_id}/publish-link", headers=author_auth)
    share_code = pub_resp.json()["share_code"]

    # User B enters via share link
    resp_b = await client.post(f"/api/public/course-share/{share_code}/enter", json={"alias_name": "Teacher B"})
    token_b = resp_b.json()["access_token"]
    auth_b = {"Authorization": f"Bearer {token_b}"}

    # User C enters via share link
    resp_c = await client.post(f"/api/public/course-share/{share_code}/enter", json={"alias_name": "Teacher C"})
    token_c = resp_c.json()["access_token"]
    auth_c = {"Authorization": f"Bearer {token_c}"}

    # --- Verification 1: Base resources are visible to both User B and User C ---
    mats_b = (await client.get(f"/api/teacher/courses/{course_id}/materials", headers=auth_b)).json()
    mats_c = (await client.get(f"/api/teacher/courses/{course_id}/materials", headers=auth_c)).json()
    assert any(m["title"] == "Course Syllabus" for m in mats_b)
    assert any(m["title"] == "Course Syllabus" for m in mats_c)

    qs_b = (await client.get(f"/api/teacher/courses/{course_id}/questions", headers=auth_b)).json()
    qs_c = (await client.get(f"/api/teacher/courses/{course_id}/questions", headers=auth_c)).json()
    assert any(q["title"] == "What is type(42)?" for q in qs_b)
    assert any(q["title"] == "What is type(42)?" for q in qs_c)

    papers_b = (await client.get("/api/papers", headers=auth_b)).json()
    papers_c = (await client.get("/api/papers", headers=auth_c)).json()
    assert any(p["title"] == "Midterm Exam Paper" for p in papers_b)
    assert any(p["title"] == "Midterm Exam Paper" for p in papers_c)

    # --- Verification 2: User B adds a private material ---
    user_b_id = uuid.UUID(resp_b.json()["user"]["id"])
    priv_mat = LearningResource(
        node_id=course_id,
        node_type="kp",
        resource_type="document",
        title="Teacher B Private Notes",
        url="/api/uploads/b_notes.pdf",
        uploaded_by=user_b_id,
    )
    db_session.add(priv_mat)

    # User B adds a private question
    bank_stmt = select(QuestionBank).where(
        QuestionBank.owner_id == env["author"].id,
        QuestionBank.name == root_knowledge_question_bank_name(env["course"].name),
    )
    bank = (await db_session.execute(bank_stmt)).scalar_one()

    priv_q = Question(
        type=QuestionType.CHOICE,
        title="Teacher B Private Question",
        content={"stem": "What is 2+2?"},
        options={"A": "4", "B": "5"},
        answer={"answer": "A"},
        difficulty=1,
        score=5.0,
        question_bank_id=bank.id,
        owner_id=user_b_id,
        created_by=user_b_id,
    )
    priv_q.knowledge_points.append(env["kp1"])
    db_session.add(priv_q)

    # User B adds a private paper
    priv_paper = Paper(
        title="Teacher B Practice Paper",
        root_knowledge_point_id=course_id,
        owner_id=user_b_id,
        created_by=user_b_id,
        is_reusable=True,
    )
    db_session.add(priv_paper)
    await db_session.commit()

    # --- Verification 3: User B sees their private additions; User C DOES NOT ---
    mats_b_after = (await client.get(f"/api/teacher/courses/{course_id}/materials", headers=auth_b)).json()
    mats_c_after = (await client.get(f"/api/teacher/courses/{course_id}/materials", headers=auth_c)).json()
    assert any(m["title"] == "Teacher B Private Notes" for m in mats_b_after)
    assert not any(m["title"] == "Teacher B Private Notes" for m in mats_c_after)

    qs_b_after = (await client.get(f"/api/teacher/courses/{course_id}/questions", headers=auth_b)).json()
    qs_c_after = (await client.get(f"/api/teacher/courses/{course_id}/questions", headers=auth_c)).json()
    assert any(q["title"] == "Teacher B Private Question" for q in qs_b_after)
    assert not any(q["title"] == "Teacher B Private Question" for q in qs_c_after)

    papers_b_after = (await client.get("/api/papers", headers=auth_b)).json()
    papers_c_after = (await client.get("/api/papers", headers=auth_c)).json()
    assert any(p["title"] == "Teacher B Practice Paper" for p in papers_b_after)
    assert not any(p["title"] == "Teacher B Practice Paper" for p in papers_c_after)

    # --- Verification 4: User B can create their own semester ---
    sem_resp = await client.post(
        f"/api/teacher/courses/{course_id}/semesters",
        json={"name": "2026 Spring Class B", "class_ids": []},
        headers=auth_b,
    )
    assert sem_resp.status_code == 201
    sem_data = sem_resp.json()
    assert sem_data["name"] == "2026 Spring Class B"

    # User B sees the semester
    sems_b = (await client.get(f"/api/teacher/courses/{course_id}/semesters", headers=auth_b)).json()
    assert any(s["name"] == "2026 Spring Class B" for s in sems_b)

    # User C does NOT see User B's semester!
    sems_c = (await client.get(f"/api/teacher/courses/{course_id}/semesters", headers=auth_c)).json()
    assert not any(s["name"] == "2026 Spring Class B" for s in sems_c)
