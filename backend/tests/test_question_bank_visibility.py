import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.models import User
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.job_models.models import LearningResource
from app.learning.models import Direction, KnowledgePoint, Major
from app.questions.models import Question, QuestionBank, QuestionType
from app.questions.service import root_knowledge_question_bank_name
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


async def _create_student(db_session, org_id, *, username: str, email: str, full_name: str):
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=email,
            password="studentpass123",
            full_name=full_name,
            role_name="student",
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
    assert response.json() == {"deleted": 2, "hard_deleted": 2, "soft_deleted": 0}

    refreshed_bank = await db_session.scalar(select(QuestionBank).where(QuestionBank.id == bank.id))
    assert refreshed_bank is not None
    assert refreshed_bank.deleted_at is None

    refreshed_questions = (
        await db_session.execute(select(Question).where(Question.id.in_([question_a.id, question_b.id])))
    ).scalars().all()
    assert len(refreshed_questions) == 0


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
async def test_course_question_create_defaults_to_course_question_bank(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-course-question-create",
        email="teacher-course-question-create@example.com",
        full_name="Teacher Course Question Create",
    )
    course = KnowledgePoint(
        name="Python程序设计",
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    child = KnowledgePoint(
        name="程序流程控制",
        parent=course,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([course, child])
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    create_response = await client.post(
        "/api/questions",
        json={
            "type": "short_answer",
            "title": "课程内创建题",
            "content": {"text": "描述循环控制"},
            "options": None,
            "answer": {"points": ["for", "while"]},
            "analysis": None,
            "difficulty": 2,
            "score": 5,
            "tag_ids": [],
            "knowledge_point_ids": [str(child.id)],
            "question_bank_id": None,
        },
    )

    assert create_response.status_code == 201
    payload = create_response.json()
    assert payload["question_bank_name"] == root_knowledge_question_bank_name(course.name)

    default_bank = await db_session.scalar(
        select(QuestionBank).where(
            QuestionBank.owner_id == teacher.id,
            QuestionBank.name == root_knowledge_question_bank_name(course.name),
        )
    )
    assert default_bank is not None
    created_question = await db_session.scalar(select(Question).where(Question.id == uuid.UUID(payload["id"])))
    assert created_question is not None
    assert created_question.question_bank_id == default_bank.id


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
    assert response.json() == {"created": 2, "existing": 0, "failed": 0}

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
async def test_teacher_bulk_create_reports_existing_duplicate_questions(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bulk-duplicate",
        email="teacher-bulk-duplicate@example.com",
        full_name="Teacher Bulk Duplicate",
    )
    db_session.add(
        Question(
            type=QuestionType.SHORT_ANSWER,
            title="Existing Duplicate Question",
            content={"text": "Describe quorum"},
            options=None,
            answer={"points": ["majority"]},
            analysis=None,
            difficulty=2,
            score=5,
            created_by=teacher.id,
            owner_id=teacher.id,
            question_bank_id=None,
        )
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(
        "/api/questions/bulk",
        json={
            "questions": [
                {
                    "type": "short_answer",
                    "title": "Imported Duplicate Question",
                    "content": {"text": "Describe quorum"},
                    "options": None,
                    "answer": {"points": ["majority"]},
                    "analysis": None,
                    "difficulty": 2,
                    "score": 5,
                    "tag_ids": [],
                    "knowledge_point_ids": [],
                    "question_bank_id": None,
                },
                {
                    "type": "short_answer",
                    "title": "Imported New Question",
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
    assert response.json() == {"created": 1, "existing": 1, "failed": 0}


@pytest.mark.asyncio
async def test_student_can_save_generated_questions_to_root_knowledge_bank(
    client: AsyncClient,
    db_session,
) -> None:
    org = Organization(name="Generated Question School", type="school", is_active=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, student_role])
    await db_session.flush()

    student = await _create_student(
        db_session,
        org.id,
        username="student-course-bank",
        email="student-course-bank@example.com",
        full_name="Student Course Bank",
    )
    student_id = student.id

    major = Major(name="人工智能")
    db_session.add(major)
    await db_session.flush()
    direction = Direction(name="AI应用", major_id=major.id)
    db_session.add(direction)
    await db_session.flush()
    root_knowledge = KnowledgePoint(
        name="Python程序设计",
        direction_id=direction.id,
        visibility=VisibilityScope.PLATFORM,
        owner_id=student_id,
    )
    db_session.add(root_knowledge)
    await db_session.flush()
    knowledge = KnowledgePoint(
        name="计算机视觉",
        parent_id=root_knowledge.id,
        direction_id=direction.id,
        visibility=VisibilityScope.PLATFORM,
        owner_id=student_id,
    )
    db_session.add(knowledge)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student_id, '')}"})
    response = await client.post(
        "/api/questions/save-generated-to-course-bank",
        json={
            "questions": [
                {
                    "type": "choice",
                    "title": "图像分类基础题",
                    "content": {"text": "下列哪项最接近图像分类任务？"},
                    "options": {
                        "A": "预测类别",
                        "B": "预测边框",
                        "C": "生成音频",
                        "D": "删除样本",
                    },
                    "answer": {"correct": "A"},
                    "analysis": "图像分类输出类别标签。",
                    "difficulty": 2,
                    "score": 10,
                    "knowledge_point_ids": [str(knowledge.id)],
                }
            ]
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["created"] == 1

    bank = await db_session.scalar(
        select(QuestionBank).where(
            QuestionBank.name == "Python程序设计-题库",
            QuestionBank.owner_id == student_id,
        )
    )
    assert bank is not None
    assert bank.visibility == VisibilityScope.PRIVATE

    question = await db_session.scalar(select(Question).where(Question.title == "图像分类基础题"))
    assert question is not None
    assert payload["created_question_ids"] == [str(question.id)]
    assert question.question_bank_id == bank.id
    assert question.owner_id == student_id


@pytest.mark.asyncio
async def test_teacher_course_creation_ensures_root_knowledge_bank(
    client: AsyncClient,
    db_session,
) -> None:
    org = Organization(name="Teacher Course Bank School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, teacher_role])
    await db_session.flush()

    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-course-root-bank",
        email="teacher-course-root-bank@example.com",
        full_name="Teacher Course Root Bank",
    )

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(
        "/api/teacher/courses",
        json={"name": "Python程序设计", "description": "Python 基础课程"},
    )

    assert response.status_code == 201
    bank = await db_session.scalar(
        select(QuestionBank).where(
            QuestionBank.name == "Python程序设计-题库",
            QuestionBank.owner_id == teacher.id,
        )
    )
    assert bank is not None
    assert bank.visibility == VisibilityScope.PRIVATE


@pytest.mark.asyncio
async def test_save_generated_questions_rejects_unreadable_knowledge_points(
    client: AsyncClient,
    db_session,
) -> None:
    org = Organization(name="Generated Question Guard School", type="school", is_active=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    db_session.add_all([org, student_role, teacher_role])
    await db_session.flush()

    student = await _create_student(
        db_session,
        org.id,
        username="student-course-bank-guard",
        email="student-course-bank-guard@example.com",
        full_name="Student Course Bank Guard",
    )
    student_id = student.id
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-private-kp-owner",
        email="teacher-private-kp-owner@example.com",
        full_name="Teacher Private KP Owner",
    )
    teacher_id = teacher.id

    major = Major(name="软件工程")
    db_session.add(major)
    await db_session.flush()
    direction = Direction(name="后端方向", major_id=major.id)
    db_session.add(direction)
    await db_session.flush()
    private_knowledge = KnowledgePoint(
        name="私有知识点",
        direction_id=direction.id,
        visibility=VisibilityScope.PRIVATE,
        owner_id=teacher_id,
    )
    db_session.add(private_knowledge)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student_id, '')}"})
    response = await client.post(
        "/api/questions/save-generated-to-course-bank",
        json={
            "questions": [
                {
                    "type": "short_answer",
                    "title": "访问控制题",
                    "content": {"text": "为什么要进行访问控制？"},
                    "options": None,
                    "answer": {"points": ["最小权限"]},
                    "analysis": "访问控制可以限制未授权访问。",
                    "difficulty": 2,
                    "score": 10,
                    "knowledge_point_ids": [str(private_knowledge.id)],
                }
            ]
        },
    )

    assert response.status_code == 403

    course_bank = await db_session.scalar(
        select(QuestionBank).where(
            QuestionBank.name == "课程题库",
            QuestionBank.owner_id == student_id,
        )
    )
    assert course_bank is None

    leaked_question = await db_session.scalar(
        select(Question).where(
            Question.owner_id == student_id,
            Question.title == "访问控制题",
        )
    )
    assert leaked_question is None


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
async def test_reimport_existing_question_relinks_to_course_root(
    client: AsyncClient, db_session, monkeypatch
) -> None:
    """重复导入已存在的题目时，应补挂到课程根知识点，使其出现在课程题目列表。"""
    from sqlalchemy.orm import selectinload

    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-reimport",
        email="teacher-reimport@example.com",
        full_name="Teacher Reimport",
    )
    major = Major(name="CS Reimport", description=None)
    db_session.add(major)
    await db_session.flush()
    direction = Direction(major_id=major.id, name="App", description=None)
    db_session.add(direction)
    await db_session.flush()
    root_knowledge_point = KnowledgePoint(
        name="Networking Course",
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
    payload = {
        "root_knowledge_point_id": str(root_knowledge_point.id),
        "questions": [
            {
                "type": "short_answer",
                "title": "Reimport Question",
                "content": {"text": "Explain TCP three-way handshake"},
                "options": None,
                "answer": {"points": ["SYN/SYN-ACK/ACK"]},
                "analysis": None,
                "difficulty": 2,
                "score": 5,
                "tag_ids": [],
                "knowledge_point_ids": [],
                "question_bank_id": None,
            }
        ],
    }

    first = await client.post("/api/questions/import/bulk-create-job", json=payload)
    assert first.status_code == 201, first.text
    assert first.json()["created"] == 1

    # 第二次导入相同题目：被去重不再创建，但应补挂到课程根知识点。
    second = await client.post("/api/questions/import/bulk-create-job", json=payload)
    assert second.status_code == 201, second.text
    assert second.json()["created"] == 0
    assert second.json()["existing"] == 1

    teacher_id = teacher.id
    root_kp_id = root_knowledge_point.id
    db_session.expire_all()
    rows = await db_session.execute(
        select(Question)
        .where(Question.owner_id == teacher_id, Question.deleted_at.is_(None))
        .options(selectinload(Question.knowledge_points))
    )
    questions = rows.scalars().unique().all()
    assert len(questions) == 1
    assert root_kp_id in {kp.id for kp in questions[0].knowledge_points}


@pytest.mark.asyncio
async def test_bulk_reimport_merges_knowledge_points_into_existing(
    client: AsyncClient, db_session
) -> None:
    """重复导入（/questions/bulk，「暂不关联」路径）时，应把本次携带的知识点合并进已有题目。"""
    from sqlalchemy.orm import selectinload

    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-bulk-merge",
        email="teacher-bulk-merge@example.com",
        full_name="Teacher Bulk Merge",
    )
    major = Major(name="CS BulkMerge", description=None)
    db_session.add(major)
    await db_session.flush()
    direction = Direction(major_id=major.id, name="App", description=None)
    db_session.add(direction)
    await db_session.flush()
    course_kp = KnowledgePoint(
        name="Course Root",
        direction_id=direction.id,
        parent_id=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    other_kp = KnowledgePoint(
        name="Other KP",
        direction_id=direction.id,
        parent_id=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([course_kp, other_kp])
    await db_session.commit()
    course_kp_id = course_kp.id
    other_kp_id = other_kp.id
    teacher_id = teacher.id

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})

    def payload(kp_id):
        return {
            "questions": [
                {
                    "type": "short_answer",
                    "title": "Bulk Merge Q",
                    "content": {"text": "What is the OSI model?"},
                    "options": None,
                    "answer": {"points": ["7 layers"]},
                    "analysis": None,
                    "difficulty": 2,
                    "score": 5,
                    "tag_ids": [],
                    "knowledge_point_ids": [str(kp_id)],
                    "question_bank_id": None,
                }
            ]
        }

    first = await client.post("/api/questions/bulk", json=payload(other_kp_id))
    assert first.status_code == 201, first.text
    assert first.json()["created"] == 1

    # 重复导入相同题目，这次带课程根知识点 → 合并进已有题目。
    second = await client.post("/api/questions/bulk", json=payload(course_kp_id))
    assert second.status_code == 201, second.text
    assert second.json()["created"] == 0
    assert second.json()["existing"] == 1

    db_session.expire_all()
    rows = await db_session.execute(
        select(Question)
        .where(Question.owner_id == teacher_id, Question.deleted_at.is_(None))
        .options(selectinload(Question.knowledge_points))
    )
    questions = rows.scalars().unique().all()
    assert len(questions) == 1
    kp_ids = {kp.id for kp in questions[0].knowledge_points}
    assert course_kp_id in kp_ids
    assert other_kp_id in kp_ids


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


@pytest.mark.asyncio
async def test_question_type_distribution_scopes_and_unions_difficulties(
    client: AsyncClient, db_session
) -> None:
    """题型分布只统计自己的题目 + 平台开放题库；多难度是并集（OR）。"""
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-type-dist",
        email="teacher-type-dist@example.com",
        full_name="Teacher Type Dist",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-type-dist-other",
        email="teacher-type-dist-other@example.com",
        full_name="Teacher Type Dist Other",
    )

    own_bank = QuestionBank(name="Own Dist Bank", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    platform_bank = QuestionBank(
        name="Platform Dist Bank", owner_id=other_teacher.id, visibility=VisibilityScope.PLATFORM
    )
    hidden_bank = QuestionBank(
        name="Hidden Dist Bank", owner_id=other_teacher.id, visibility=VisibilityScope.PRIVATE
    )
    db_session.add_all([own_bank, platform_bank, hidden_bank])
    await db_session.flush()

    def _q(title: str, qtype: QuestionType, difficulty: int, owner, bank) -> Question:
        return Question(
            type=qtype,
            title=title,
            content={"text": title},
            options=None,
            answer={"points": ["x"]},
            analysis=None,
            difficulty=difficulty,
            score=5,
            created_by=owner.id,
            owner_id=owner.id,
            question_bank_id=bank.id,
        )

    db_session.add_all(
        [
            _q("own choice easy 1", QuestionType.CHOICE, 2, teacher, own_bank),
            _q("own choice easy 2", QuestionType.CHOICE, 2, teacher, own_bank),
            _q("own fill hard", QuestionType.FILL_IN, 4, teacher, own_bank),
            # 平台开放题库里的题目可见
            _q("platform short", QuestionType.SHORT_ANSWER, 2, other_teacher, platform_bank),
            # 他人私有题库里的题目不可见，不应计入
            _q("hidden choice", QuestionType.CHOICE, 2, other_teacher, hidden_bank),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})

    # 无筛选：统计可见范围内全部题型
    resp = await client.get("/api/questions/type-distribution")
    assert resp.status_code == 200
    counts = {row["type"]: row["count"] for row in resp.json()}
    assert counts == {"choice": 2, "fill_in": 1, "short_answer": 1}  # 他人私有的 choice 未泄漏
    assert resp.headers["x-total-count"] == "4"

    # 仅本人题库：排除平台题库
    resp_bank = await client.get(f"/api/questions/type-distribution?question_bank_id={own_bank.id}")
    counts_bank = {row["type"]: row["count"] for row in resp_bank.json()}
    assert counts_bank == {"choice": 2, "fill_in": 1}

    # 难度并集 {2,4}：与无筛选一致（OR，不是 AND）
    resp_union = await client.get("/api/questions/type-distribution?difficulty_in=2,4")
    counts_union = {row["type"]: row["count"] for row in resp_union.json()}
    assert counts_union == {"choice": 2, "fill_in": 1, "short_answer": 1}

    # 仅难度 {4}：只剩填空题
    resp_hard = await client.get("/api/questions/type-distribution?difficulty_in=4")
    counts_hard = {row["type"]: row["count"] for row in resp_hard.json()}
    assert counts_hard == {"fill_in": 1}


@pytest.mark.asyncio
async def test_course_knowledge_tree_returns_nested_rollup_counts(
    client: AsyncClient,
    db_session,
) -> None:
    org = await _create_org_with_question_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-course-tree",
        email="teacher-course-tree@example.com",
        full_name="Teacher Course Tree",
    )

    course = KnowledgePoint(name="大数据分析技术", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    db_session.add(course)
    await db_session.flush()
    course_bank = QuestionBank(
        name=root_knowledge_question_bank_name(course.name),
        description="课程默认题库",
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add(course_bank)
    await db_session.flush()
    intro = KnowledgePoint(name="课程导论", parent_id=course.id, owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    db_session.add(intro)
    await db_session.flush()
    leaf_a = KnowledgePoint(name="大数据4V特征", parent_id=intro.id, owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    leaf_b = KnowledgePoint(name="大数据生态", parent_id=intro.id, owner_id=teacher.id, visibility=VisibilityScope.PRIVATE)
    db_session.add_all([leaf_a, leaf_b])
    await db_session.flush()

    def _q(title: str, kp: KnowledgePoint) -> Question:
        return Question(
            type=QuestionType.SHORT_ANSWER,
            title=title,
            content={"text": title},
            options=None,
            answer={"points": ["x"]},
            analysis=None,
            difficulty=2,
            score=5,
            created_by=teacher.id,
            owner_id=teacher.id,
            question_bank_id=course_bank.id,
            knowledge_points=[kp],
        )

    outside_bank_question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="Q-outside-bank",
        content={"text": "Q-outside-bank"},
        options=None,
        answer={"points": ["x"]},
        analysis=None,
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
        question_bank_id=None,
        knowledge_points=[leaf_a],
    )

    db_session.add_all([_q("Q1", leaf_a), _q("Q2", leaf_a), _q("Q3", leaf_b), outside_bank_question])
    db_session.add_all(
        [
            LearningResource(node_id=leaf_a.id, node_type="kp", resource_type="link", title="资料A"),
            LearningResource(node_id=leaf_b.id, node_type="kp", resource_type="link", title="资料B"),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    detail_response = await client.get(f"/api/teacher/courses/{course.id}")
    questions_response = await client.get(f"/api/teacher/courses/{course.id}/questions")
    response = await client.get(f"/api/teacher/courses/{course.id}/knowledge-tree")

    assert detail_response.status_code == 200
    assert detail_response.json()["question_count"] == 3

    assert questions_response.status_code == 200
    assert {item["title"] for item in questions_response.json()} == {"Q1", "Q2", "Q3"}

    assert response.status_code == 200
    root = response.json()
    assert root["name"] == "大数据分析技术"
    assert root["question_count"] == 3
    assert root["material_count"] == 2

    intro_node = root["children"][0]
    assert intro_node["name"] == "课程导论"
    assert intro_node["question_count"] == 3
    assert intro_node["material_count"] == 2
    assert {child["name"]: child["question_count"] for child in intro_node["children"]} == {
        "大数据4V特征": 2,
        "大数据生态": 1,
    }
