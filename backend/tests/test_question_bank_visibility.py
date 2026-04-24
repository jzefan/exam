import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.models import User
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.learning.models import Direction, KnowledgePoint, Major
from app.questions.models import Question, QuestionBank, QuestionType
from app.rbac.models import Organization, Role


async def _create_org_with_question_roles(db_session):
    org = Organization(name="Question Bank Visibility School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, teacher_role])
    await db_session.flush()
    return org


async def _create_teacher(db_session, org_id, *, username: str, email: str, full_name: str):
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


@pytest.mark.asyncio
async def test_teacher_sees_own_and_platform_banks_only(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bank-owner",
        email="teacher-bank-owner@example.com",
        full_name="Teacher Bank Owner",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bank-other",
        email="teacher-bank-other@example.com",
        full_name="Teacher Bank Other",
    )

    own_bank = QuestionBank(
        name="My Bank",
        description=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    shared_bank = QuestionBank(
        name="Shared Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PLATFORM,
    )
    hidden_bank = QuestionBank(
        name="Hidden Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([own_bank, shared_bank, hidden_bank])
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/question-banks")

    assert response.status_code == 200
    payload = response.json()
    assert [item["name"] for item in payload] == ["My Bank", "Shared Bank"]
    assert payload[0]["owner_id"] == str(teacher.id)
    assert payload[0]["visibility"] == "private"
    assert payload[1]["owner_id"] == str(other_teacher.id)
    assert payload[1]["visibility"] == "platform"


@pytest.mark.asyncio
async def test_create_question_bank_sets_owner_and_private_visibility(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bank-create",
        email="teacher-bank-create@example.com",
        full_name="Teacher Bank Create",
    )

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(
        "/api/question-banks",
        json={"name": "Created Bank", "description": "Scoped bank"},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["owner_id"] == str(teacher.id)
    assert payload["visibility"] == "private"

    created_bank = await db_session.scalar(select(QuestionBank).where(QuestionBank.name == "Created Bank"))
    assert created_bank is not None
    assert created_bank.owner_id == teacher.id
    assert created_bank.visibility == VisibilityScope.PRIVATE


@pytest.mark.asyncio
async def test_teacher_cannot_delete_other_teachers_platform_visible_bank(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bank-delete-owner",
        email="teacher-bank-delete-owner@example.com",
        full_name="Teacher Bank Delete Owner",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bank-delete-other",
        email="teacher-bank-delete-other@example.com",
        full_name="Teacher Bank Delete Other",
    )

    shared_bank = QuestionBank(
        name="Delete Protected Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PLATFORM,
    )
    db_session.add(shared_bank)
    await db_session.flush()
    shared_bank_id = shared_bank.id
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.delete(f"/api/question-banks/{shared_bank_id}")

    assert response.status_code == 403

    refreshed_bank = await db_session.scalar(select(QuestionBank).where(QuestionBank.id == shared_bank_id))
    assert refreshed_bank is not None
    assert refreshed_bank.deleted_at is None


@pytest.mark.asyncio
async def test_teacher_delete_other_teachers_private_bank_is_not_found(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bank-private-delete",
        email="teacher-bank-private-delete@example.com",
        full_name="Teacher Bank Private Delete",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bank-private-delete-other",
        email="teacher-bank-private-delete-other@example.com",
        full_name="Teacher Bank Private Delete Other",
    )

    private_bank = QuestionBank(
        name="Invisible Private Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(private_bank)
    await db_session.flush()
    private_bank_id = private_bank.id
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.delete(f"/api/question-banks/{private_bank_id}")

    assert response.status_code == 404

    refreshed_bank = await db_session.scalar(select(QuestionBank).where(QuestionBank.id == private_bank_id))
    assert refreshed_bank is not None
    assert refreshed_bank.deleted_at is None


@pytest.mark.asyncio
async def test_teacher_can_clear_own_question_bank_questions_without_deleting_bank(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bank-clear-owner",
        email="teacher-bank-clear-owner@example.com",
        full_name="Teacher Bank Clear Owner",
    )

    bank = QuestionBank(
        name="Clearable Bank",
        description=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(bank)
    await db_session.flush()

    question_a = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Bank Question A",
        content={"text": "Describe caching"},
        options=None,
        answer={"points": ["cache"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
        question_bank_id=bank.id,
    )
    question_b = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Bank Question B",
        content={"text": "Describe queues"},
        options=None,
        answer={"points": ["fifo"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
        question_bank_id=bank.id,
    )
    db_session.add_all([question_a, question_b])
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(f"/api/question-banks/{bank.id}/clear")

    assert response.status_code == 200
    assert response.json() == {"deleted": 2}

    refreshed_bank = await db_session.scalar(select(QuestionBank).where(QuestionBank.id == bank.id))
    assert refreshed_bank is not None
    assert refreshed_bank.deleted_at is None

    refreshed_questions = (
        await db_session.execute(select(Question).where(Question.id.in_([question_a.id, question_b.id])))
    ).scalars().all()
    assert len(refreshed_questions) == 2
    assert all(question.deleted_at is not None for question in refreshed_questions)


@pytest.mark.asyncio
async def test_teacher_create_question_sets_owner_and_teacher_cannot_modify_other_question(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-question-create",
        email="teacher-question-create@example.com",
        full_name="Teacher Question Create",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-question-visible-other",
        email="teacher-question-visible-other@example.com",
        full_name="Teacher Question Visible Other",
    )

    shared_bank = QuestionBank(
        name="Visible Shared Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PLATFORM,
    )
    db_session.add(shared_bank)
    await db_session.flush()

    protected_question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Other Visible Question",
        content={"text": "Describe replication"},
        options=None,
        answer={"points": ["leader", "follower"]},
        analysis=None,
        difficulty=3,
        score=10,
        created_by=other_teacher.id,
        owner_id=other_teacher.id,
        question_bank_id=shared_bank.id,
    )
    db_session.add(protected_question)
    await db_session.flush()
    protected_question_id = protected_question.id
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    create_response = await client.post(
        "/api/questions",
        json={
            "type": "short_answer",
            "title": "Owned Created Question",
            "content": {"text": "Describe denormalization"},
            "options": None,
            "answer": {"points": ["tradeoff"]},
            "analysis": None,
            "difficulty": 2,
            "score": 5,
            "tag_ids": [],
            "knowledge_point_ids": [],
            "question_bank_id": None,
        },
    )

    assert create_response.status_code == 201
    create_payload = create_response.json()
    assert create_payload["owner_id"] == str(teacher.id)

    created_question = await db_session.scalar(
        select(Question).where(Question.title == "Owned Created Question")
    )
    assert created_question is not None
    assert created_question.owner_id == teacher.id

    update_response = await client.put(
        f"/api/questions/{protected_question_id}",
        json={"title": "Should Not Update"},
    )
    assert update_response.status_code == 403

    delete_response = await client.delete(f"/api/questions/{protected_question_id}")
    assert delete_response.status_code == 403

    db_question = await db_session.scalar(select(Question).where(Question.id == protected_question_id))
    assert db_question is not None
    assert db_question.title == "Other Visible Question"
    assert db_question.deleted_at is None


@pytest.mark.asyncio
async def test_teacher_cannot_create_or_move_question_into_other_teachers_bank(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-question-bank-guard",
        email="teacher-question-bank-guard@example.com",
        full_name="Teacher Question Bank Guard",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-question-bank-guard-other",
        email="teacher-question-bank-guard-other@example.com",
        full_name="Teacher Question Bank Guard Other",
    )

    foreign_private_bank = QuestionBank(
        name="Foreign Private Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    foreign_platform_bank = QuestionBank(
        name="Foreign Platform Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PLATFORM,
    )
    owned_question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Owned Movable Question",
        content={"text": "Describe isolation"},
        options=None,
        answer={"points": ["locks"]},
        analysis=None,
        difficulty=3,
        score=10,
        created_by=teacher.id,
        owner_id=teacher.id,
        question_bank_id=None,
    )
    db_session.add_all([foreign_private_bank, foreign_platform_bank, owned_question])
    await db_session.flush()
    foreign_private_bank_id = foreign_private_bank.id
    foreign_platform_bank_id = foreign_platform_bank.id
    owned_question_id = owned_question.id
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    create_response = await client.post(
        "/api/questions",
        json={
            "type": "short_answer",
            "title": "Should Not Attach",
            "content": {"text": "Describe replication"},
            "options": None,
            "answer": {"points": ["leader"]},
            "analysis": None,
            "difficulty": 2,
            "score": 5,
            "tag_ids": [],
            "knowledge_point_ids": [],
            "question_bank_id": str(foreign_private_bank_id),
        },
    )
    assert create_response.status_code == 404

    move_response = await client.put(
        f"/api/questions/{owned_question_id}",
        json={"question_bank_id": str(foreign_platform_bank_id)},
    )
    assert move_response.status_code == 403

    refreshed_question = await db_session.scalar(select(Question).where(Question.id == owned_question_id))
    assert refreshed_question is not None
    assert refreshed_question.question_bank_id is None


@pytest.mark.asyncio
async def test_teacher_bulk_create_cannot_attach_to_other_teachers_banks(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bulk-bank-guard",
        email="teacher-bulk-bank-guard@example.com",
        full_name="Teacher Bulk Bank Guard",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bulk-bank-guard-other",
        email="teacher-bulk-bank-guard-other@example.com",
        full_name="Teacher Bulk Bank Guard Other",
    )

    foreign_private_bank = QuestionBank(
        name="Bulk Foreign Private Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    foreign_platform_bank = QuestionBank(
        name="Bulk Foreign Platform Bank",
        description=None,
        owner_id=other_teacher.id,
        visibility=VisibilityScope.PLATFORM,
    )
    db_session.add_all([foreign_private_bank, foreign_platform_bank])
    await db_session.flush()
    foreign_private_bank_id = foreign_private_bank.id
    foreign_platform_bank_id = foreign_platform_bank.id
    await db_session.commit()

    def bulk_payload(question_bank_id) -> dict:
        return {
            "questions": [
                {
                    "type": "short_answer",
                    "title": "Bulk Should Not Attach",
                    "content": {"text": "Describe quorum"},
                    "options": None,
                    "answer": {"points": ["majority"]},
                    "analysis": None,
                    "difficulty": 2,
                    "score": 5,
                    "tag_ids": [],
                    "knowledge_point_ids": [],
                    "question_bank_id": str(question_bank_id),
                }
            ]
        }

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    private_response = await client.post("/api/questions/bulk", json=bulk_payload(foreign_private_bank_id))
    platform_response = await client.post("/api/questions/bulk", json=bulk_payload(foreign_platform_bank_id))

    assert private_response.status_code == 404
    assert platform_response.status_code == 403

    leaked_question = await db_session.scalar(select(Question).where(Question.title == "Bulk Should Not Attach"))
    assert leaked_question is None


@pytest.mark.asyncio
async def test_teacher_bulk_create_allows_owned_bank_and_unbanked_questions(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bulk-owned",
        email="teacher-bulk-owned@example.com",
        full_name="Teacher Bulk Owned",
    )
    owned_bank = QuestionBank(
        name="Bulk Owned Bank",
        description=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(owned_bank)
    await db_session.flush()
    owned_bank_id = owned_bank.id
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(
        "/api/questions/bulk",
        json={
            "questions": [
                {
                    "type": "short_answer",
                    "title": "Bulk Owned Bank Question",
                    "content": {"text": "Describe quorum"},
                    "options": None,
                    "answer": {"points": ["majority"]},
                    "analysis": None,
                    "difficulty": 2,
                    "score": 5,
                    "tag_ids": [],
                    "knowledge_point_ids": [],
                    "question_bank_id": str(owned_bank_id),
                },
                {
                    "type": "short_answer",
                    "title": "Bulk Unbanked Question",
                    "content": {"text": "Describe consensus"},
                    "options": None,
                    "answer": {"points": ["agreement"]},
                    "analysis": None,
                    "difficulty": 3,
                    "score": 8,
                    "tag_ids": [],
                    "knowledge_point_ids": [],
                    "question_bank_id": None,
                },
            ]
        },
    )

    assert response.status_code == 201
    assert response.json() == {"created": 2}

    created_questions = (
        await db_session.execute(
            select(Question).where(
                Question.title.in_(["Bulk Owned Bank Question", "Bulk Unbanked Question"])
            )
        )
    ).scalars().all()
    assert {question.owner_id for question in created_questions} == {teacher.id}
    assert {question.question_bank_id for question in created_questions} == {owned_bank_id, None}


@pytest.mark.asyncio
async def test_teacher_import_bulk_create_job_accepts_visible_root_knowledge_point(
    client: AsyncClient, db_session, monkeypatch
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-import-job",
        email="teacher-import-job@example.com",
        full_name="Teacher Import Job",
    )
    major = Major(name="Computer Science", description=None)
    db_session.add(major)
    await db_session.flush()
    direction = Direction(major_id=major.id, name="Application", description=None)
    db_session.add(direction)
    await db_session.flush()
    root_knowledge_point = KnowledgePoint(
        name="Database Systems",
        direction_id=direction.id,
        parent_id=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(root_knowledge_point)
    await db_session.commit()

    async def noop_process_question_import_job(**_kwargs):
        return None

    monkeypatch.setattr(
        "app.questions.router.process_question_import_job",
        noop_process_question_import_job,
    )

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(
        "/api/questions/import/bulk-create-job",
        json={
            "root_knowledge_point_id": str(root_knowledge_point.id),
            "questions": [
                {
                    "type": "short_answer",
                    "title": "Import Job Question",
                    "content": {"text": "Describe transaction isolation"},
                    "options": None,
                    "answer": {"points": ["read committed"]},
                    "analysis": None,
                    "difficulty": 2,
                    "score": 5,
                    "tag_ids": [],
                    "knowledge_point_ids": [],
                    "question_bank_id": None,
                }
            ],
        },
    )

    assert response.status_code == 201, response.text
    assert response.json()["created"] == 1


@pytest.mark.asyncio
async def test_admin_can_see_all_question_banks_and_questions(admin_client, db_session) -> None:
    admin_user = (await db_session.execute(select(User).where(User.username == "admin"))).scalar_one()

    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add(teacher_role)
    await db_session.flush()

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-admin-visibility",
            email="teacher-admin-visibility@example.com",
            password="teacherpass123",
            full_name="Teacher Admin Visibility",
            role_name="teacher",
        ),
    )

    private_bank = QuestionBank(
        name="Teacher Private Bank",
        description=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    private_question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Teacher Private Question",
        content={"text": "Describe WAL"},
        options=None,
        answer={"points": ["log"]},
        analysis=None,
        difficulty=3,
        score=10,
        created_by=teacher.id,
        owner_id=teacher.id,
        question_bank=private_bank,
    )
    db_session.add_all([private_bank, private_question])
    await db_session.commit()

    banks_response = await admin_client.get("/api/question-banks")
    assert banks_response.status_code == 200
    assert [item["name"] for item in banks_response.json()] == ["Teacher Private Bank"]

    questions_response = await admin_client.get("/api/questions?_start=0&_end=10")
    assert questions_response.status_code == 200
    payload = questions_response.json()
    assert [item["title"] for item in payload] == ["Teacher Private Question"]
    assert payload[0]["owner_id"] == str(teacher.id)
    assert payload[0]["created_by"] == str(teacher.id)
    assert str(admin_user.id) != payload[0]["owner_id"]
