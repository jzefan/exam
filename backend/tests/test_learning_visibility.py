import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.models import User
from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.learning.models import Direction, KnowledgePoint, Major
from app.questions.models import Question
from app.rbac.models import Organization, Role


async def _create_org_with_teacher_role(db_session):
    org = Organization(name="Learning Visibility School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    platform_admin_role = Role(name="platform_admin", display_name="Platform Admin", is_system=True)
    db_session.add_all([org, teacher_role, platform_admin_role])
    await db_session.flush()
    return org


async def _create_teacher(db_session, org_id, *, username: str, email: str, full_name: str) -> User:
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=email,
            password="teacherpass123",
            full_name=full_name,
            role_name="teacher",
            org_id=org_id,
        ),
    )


async def _create_platform_admin(db_session, org_id, *, username: str, email: str, full_name: str) -> User:
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=email,
            password="platformpass123",
            full_name=full_name,
            role_name="platform_admin",
            org_id=org_id,
        ),
    )


async def _create_direction(db_session) -> Direction:
    major = Major(name="Visibility Major", description=None)
    direction = Direction(name="Visibility Direction", description=None, major=major)
    db_session.add_all([major, direction])
    await db_session.flush()
    return direction


@pytest.mark.asyncio
async def test_teacher_sees_own_and_platform_knowledge_points_only(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_teacher_role(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-kp-owner",
        email="teacher-kp-owner@example.com",
        full_name="Teacher KP Owner",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-kp-other",
        email="teacher-kp-other@example.com",
        full_name="Teacher KP Other",
    )
    direction = await _create_direction(db_session)

    own = KnowledgePoint(
        name="My Knowledge",
        direction_id=direction.id,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    shared = KnowledgePoint(
        name="Shared Knowledge",
        direction_id=direction.id,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PLATFORM,
    )
    hidden = KnowledgePoint(
        name="Hidden Knowledge",
        direction_id=direction.id,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([own, shared, hidden])
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    tree_response = await client.get(f"/api/knowledge/directions/{direction.id}/tree")
    list_response = await client.get("/api/knowledge-points")

    assert tree_response.status_code == 200
    assert [node["data"]["name"] for node in tree_response.json()["nodes"]] == [
        "My Knowledge",
        "Shared Knowledge",
    ]
    assert {node["data"]["visibility"] for node in tree_response.json()["nodes"]} == {
        "private",
        "platform",
    }

    assert list_response.status_code == 200
    assert [item["name"] for item in list_response.json()] == ["My Knowledge", "Shared Knowledge"]


@pytest.mark.asyncio
async def test_teacher_only_sees_majors_and_directions_with_visible_knowledge_points(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_teacher_role(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-kp-structure",
        email="teacher-kp-structure@example.com",
        full_name="Teacher KP Structure",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-kp-structure-other",
        email="teacher-kp-structure-other@example.com",
        full_name="Teacher KP Structure Other",
    )

    visible_major = Major(name="Visible Major", description=None)
    hidden_major = Major(name="Hidden Major", description=None)
    visible_direction = Direction(name="Visible Direction", description=None, major=visible_major)
    hidden_direction = Direction(name="Hidden Direction", description=None, major=hidden_major)
    db_session.add_all([visible_major, hidden_major, visible_direction, hidden_direction])
    await db_session.flush()

    db_session.add_all([
        KnowledgePoint(
            name="Visible Knowledge",
            direction_id=visible_direction.id,
            owner_id=teacher.id,
            visibility=VisibilityScope.PRIVATE,
        ),
        KnowledgePoint(
            name="Hidden Knowledge",
            direction_id=hidden_direction.id,
            owner_id=other_teacher.id,
            visibility=VisibilityScope.PRIVATE,
        ),
    ])
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    majors_response = await client.get("/api/knowledge/majors")
    directions_response = await client.get(f"/api/knowledge/majors/{visible_major.id}/directions")
    hidden_directions_response = await client.get(f"/api/knowledge/majors/{hidden_major.id}/directions")
    hidden_tree_response = await client.get(f"/api/knowledge/directions/{hidden_direction.id}/tree")

    assert majors_response.status_code == 200
    assert [item["name"] for item in majors_response.json()] == ["Visible Major"]
    assert directions_response.status_code == 200
    assert [item["name"] for item in directions_response.json()] == ["Visible Direction"]
    assert hidden_directions_response.status_code == 200
    assert hidden_directions_response.json() == []
    assert hidden_tree_response.status_code == 404


@pytest.mark.asyncio
async def test_platform_admin_cannot_see_other_users_private_learning_structure(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_teacher_role(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-private-structure",
        email="teacher-private-structure@example.com",
        full_name="Teacher Private Structure",
    )
    platform_admin = await _create_platform_admin(
        db_session,
        org.id,
        username="platform-admin-private-structure",
        email="platform-admin-private-structure@example.com",
        full_name="Platform Admin Private Structure",
    )

    private_major = Major(name="Teacher Private Major", description=None)
    private_direction = Direction(name="Teacher Private Direction", description=None, major=private_major)
    public_major = Major(name="Public Major", description=None)
    public_direction = Direction(name="Public Direction", description=None, major=public_major)
    db_session.add_all([private_major, private_direction, public_major, public_direction])
    await db_session.flush()

    db_session.add_all([
        KnowledgePoint(
            name="Teacher Private Root",
            direction_id=private_direction.id,
            owner_id=teacher.id,
            visibility=VisibilityScope.PRIVATE,
        ),
        KnowledgePoint(
            name="Public Root",
            direction_id=public_direction.id,
            owner_id=platform_admin.id,
            visibility=VisibilityScope.PLATFORM,
        ),
    ])
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(platform_admin.id, '')}"})
    majors_response = await client.get("/api/knowledge/majors")
    private_directions_response = await client.get(f"/api/knowledge/majors/{private_major.id}/directions")
    private_tree_response = await client.get(f"/api/knowledge/directions/{private_direction.id}/tree")

    assert majors_response.status_code == 200
    assert [item["name"] for item in majors_response.json()] == ["Public Major"]
    assert private_directions_response.status_code == 200
    assert private_directions_response.json() == []
    assert private_tree_response.status_code == 404


@pytest.mark.asyncio
async def test_teacher_created_knowledge_points_are_owned_and_private(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_teacher_role(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-kp-create",
        email="teacher-kp-create@example.com",
        full_name="Teacher KP Create",
    )
    direction = await _create_direction(db_session)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    learning_response = await client.post(
        "/api/knowledge/knowledge-points",
        json={"direction_id": str(direction.id), "name": "Created In Tree"},
    )
    simple_response = await client.post(
        "/api/knowledge-points",
        json={"name": "Created In Picker", "description": "picker"},
    )

    assert learning_response.status_code == 201
    assert learning_response.json()["owner_id"] == str(teacher.id)
    assert learning_response.json()["visibility"] == "private"

    assert simple_response.status_code == 201
    assert simple_response.json()["owner_id"] == str(teacher.id)
    assert simple_response.json()["visibility"] == "private"

    created = (
        await db_session.execute(
            select(KnowledgePoint).where(KnowledgePoint.name.in_(["Created In Tree", "Created In Picker"]))
        )
    ).scalars().all()
    assert {kp.owner_id for kp in created} == {teacher.id}
    assert {kp.visibility for kp in created} == {VisibilityScope.PRIVATE}


@pytest.mark.asyncio
async def test_teacher_cannot_modify_other_teachers_knowledge_points(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_teacher_role(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-kp-write",
        email="teacher-kp-write@example.com",
        full_name="Teacher KP Write",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-kp-write-other",
        email="teacher-kp-write-other@example.com",
        full_name="Teacher KP Write Other",
    )
    direction = await _create_direction(db_session)
    shared = KnowledgePoint(
        name="Readonly Shared Knowledge",
        direction_id=direction.id,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PLATFORM,
    )
    hidden = KnowledgePoint(
        name="Invisible Private Knowledge",
        direction_id=direction.id,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([shared, hidden])
    await db_session.flush()
    direction_id = direction.id
    shared_id = shared.id
    hidden_id = hidden.id
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    update_shared = await client.put(
        f"/api/knowledge/knowledge-points/{shared_id}",
        json={"name": "Should Not Update"},
    )
    delete_shared = await client.delete(f"/api/knowledge/knowledge-points/{shared_id}")
    update_hidden = await client.put(
        f"/api/knowledge/knowledge-points/{hidden_id}",
        json={"name": "Should Not Leak"},
    )
    create_child_under_shared = await client.post(
        "/api/knowledge/knowledge-points",
        json={"direction_id": str(direction_id), "name": "Personal Child", "parent_id": str(shared_id)},
    )

    assert update_shared.status_code == 403
    assert delete_shared.status_code == 403
    assert update_hidden.status_code == 404
    assert create_child_under_shared.status_code == 201
    assert create_child_under_shared.json()["owner_id"] == str(teacher.id)
    assert create_child_under_shared.json()["visibility"] == "private"

    refreshed_shared = await db_session.scalar(select(KnowledgePoint).where(KnowledgePoint.id == shared_id))
    refreshed_hidden = await db_session.scalar(select(KnowledgePoint).where(KnowledgePoint.id == hidden_id))
    created_child = await db_session.scalar(select(KnowledgePoint).where(KnowledgePoint.name == "Personal Child"))
    assert refreshed_shared is not None
    assert refreshed_shared.name == "Readonly Shared Knowledge"
    assert refreshed_shared.deleted_at is None
    assert refreshed_hidden is not None
    assert refreshed_hidden.name == "Invisible Private Knowledge"
    assert created_child is not None
    assert created_child.parent_id == shared_id
    assert created_child.owner_id == teacher.id
    assert created_child.visibility == VisibilityScope.PRIVATE


@pytest.mark.asyncio
async def test_teacher_question_create_can_use_shared_but_not_private_knowledge_points(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_teacher_role(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-kp-question",
        email="teacher-kp-question@example.com",
        full_name="Teacher KP Question",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-kp-question-other",
        email="teacher-kp-question-other@example.com",
        full_name="Teacher KP Question Other",
    )
    shared = KnowledgePoint(
        name="Question Shared KP",
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PLATFORM,
    )
    hidden = KnowledgePoint(
        name="Question Hidden KP",
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([shared, hidden])
    await db_session.flush()
    shared_id = shared.id
    hidden_id = hidden.id
    await db_session.commit()

    def question_payload(title: str, knowledge_point_id) -> dict:
        return {
            "type": "short_answer",
            "title": title,
            "content": {"text": "Describe dependency"},
            "options": None,
            "answer": {"points": ["visible"]},
            "analysis": None,
            "difficulty": 2,
            "score": 5,
            "tag_ids": [],
            "knowledge_point_ids": [str(knowledge_point_id)],
            "question_bank_id": None,
        }

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    shared_response = await client.post(
        "/api/questions",
        json=question_payload("Question With Shared KP", shared_id),
    )
    hidden_response = await client.post(
        "/api/questions",
        json=question_payload("Question With Hidden KP", hidden_id),
    )

    assert shared_response.status_code == 201
    assert hidden_response.status_code == 404

    leaked_question = await db_session.scalar(select(Question).where(Question.title == "Question With Hidden KP"))
    assert leaked_question is None
