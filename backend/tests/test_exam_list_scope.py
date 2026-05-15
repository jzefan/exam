from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion, ExamStudent
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role


async def _create_org_with_roles(db_session):
    org = Organization(name="Scoped School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, teacher_role, student_role])
    await db_session.flush()
    return org


@pytest.mark.asyncio
async def test_student_only_gets_assigned_exams_from_exam_list(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-scope",
            email="teacher-scope@example.com",
            password="teacherpass123",
            full_name="Teacher Scope",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    other_teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-full-other",
            email="teacher-full-other@example.com",
            password="teacherpass123",
            full_name="Teacher Full Other",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student-scope",
            email="student-scope@example.com",
            password="studentpass123",
            full_name="Student Scope",
            role_name="student",
            org_id=org.id,
        ),
    )

    assigned_exam = Exam(
        title="只属于当前学生的考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=100,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    unrelated_exam = Exam(
        title="别的学生的考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=100,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([assigned_exam, unrelated_exam])
    await db_session.flush()

    db_session.add(ExamStudent(exam_id=assigned_exam.id, student_id=student.id))
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    response = await client.get("/api/exams")

    assert response.status_code == 200
    payload = response.json()
    assert [item["title"] for item in payload] == ["只属于当前学生的考试"]


@pytest.mark.asyncio
async def test_student_exam_list_excludes_draft_exams(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-draft",
            email="teacher-draft@example.com",
            password="teacherpass123",
            full_name="Teacher Draft",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student-draft",
            email="student-draft@example.com",
            password="studentpass123",
            full_name="Student Draft",
            role_name="student",
            org_id=org.id,
        ),
    )

    published_exam = Exam(
        title="已发布考试",
        description=None,
        start_time=datetime.now(timezone.utc) + timedelta(hours=1),
        end_time=datetime.now(timezone.utc) + timedelta(hours=2),
        duration_minutes=60,
        total_score=100,
        status="upcoming",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    draft_exam = Exam(
        title="草稿考试",
        description=None,
        start_time=datetime.now(timezone.utc) + timedelta(hours=1),
        end_time=datetime.now(timezone.utc) + timedelta(hours=2),
        duration_minutes=60,
        total_score=100,
        status="draft",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([published_exam, draft_exam])
    await db_session.flush()

    db_session.add_all(
        [
            ExamStudent(exam_id=published_exam.id, student_id=student.id),
            ExamStudent(exam_id=draft_exam.id, student_id=student.id),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    response = await client.get("/api/exams")

    assert response.status_code == 200
    payload = response.json()
    assert [item["title"] for item in payload] == ["已发布考试"]


@pytest.mark.asyncio
async def test_teacher_keeps_full_exam_list(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-full",
            email="teacher-full@example.com",
            password="teacherpass123",
            full_name="Teacher Full",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    other_teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-full-other",
            email="teacher-full-other@example.com",
            password="teacherpass123",
            full_name="Teacher Full Other",
            role_name="teacher",
            org_id=org.id,
        ),
    )

    exam_a = Exam(
        title="考试 A",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=100,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    exam_b = Exam(
        title="考试 B",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=60,
        total_score=100,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    other_exam = Exam(
        title="他人考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(days=1),
        end_time=datetime.now(timezone.utc) + timedelta(days=1),
        duration_minutes=60,
        total_score=100,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=other_teacher.id,
        owner_id=other_teacher.id,
    )
    db_session.add_all([exam_a, exam_b, other_exam])
    await db_session.flush()
    other_exam_id = other_exam.id
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/exams")

    assert response.status_code == 200
    payload = response.json()
    assert {item["title"] for item in payload} == {"考试 A", "考试 B"}
    assert {item["owner_id"] for item in payload} == {str(teacher.id)}

    detail_response = await client.get(f"/api/exams/{other_exam_id}")
    update_response = await client.patch(f"/api/exams/{other_exam_id}", json={"title": "越权修改"})

    assert detail_response.status_code == 404
    assert update_response.status_code == 404


@pytest.mark.asyncio
async def test_teacher_can_create_and_filter_practice_items(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-practice",
            email="teacher-practice@example.com",
            password="teacherpass123",
            full_name="Teacher Practice",
            role_name="teacher",
            org_id=org.id,
        ),
    )

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    create_response = await client.post(
        "/api/exams",
        json={
            "category": "practice",
            "title": "数组基础练习",
            "duration_minutes": 45,
            "total_score": 20,
            "status": "ongoing",
            "question_ids": [],
            "student_ids": [],
        },
    )

    assert create_response.status_code == 201
    assert create_response.json()["category"] == "practice"

    list_response = await client.get(
        "/api/exams",
        params={"filters": '[{"field":"category","operator":"eq","value":"practice"}]'},
    )

    assert list_response.status_code == 200
    payload = list_response.json()
    assert [item["title"] for item in payload] == ["数组基础练习"]
    assert payload[0]["category"] == "practice"


@pytest.mark.asyncio
async def test_student_exam_list_includes_submission_state(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-state",
            email="teacher-state@example.com",
            password="teacherpass123",
            full_name="Teacher State",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student-state",
            email="student-state@example.com",
            password="studentpass123",
            full_name="Student State",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam = Exam(
        title="已自动提交考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(hours=1),
        end_time=datetime.now(timezone.utc) + timedelta(hours=1),
        duration_minutes=60,
        total_score=100,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    submitted_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db_session.add(
        ExamStudent(
            exam_id=exam.id,
            student_id=student.id,
            started_at=datetime.now(timezone.utc) - timedelta(minutes=30),
            submitted_at=submitted_at,
            score=88,
        )
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    response = await client.get("/api/exams")

    assert response.status_code == 200
    payload = response.json()
    assert payload[0]["participated"] is True
    assert payload[0]["started_at"] is not None
    assert payload[0]["submitted_at"] is not None
    assert payload[0]["score"] == 88


@pytest.mark.asyncio
async def test_updating_exam_preserves_existing_submitted_student_record(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-preserve",
            email="teacher-preserve@example.com",
            password="teacherpass123",
            full_name="Teacher Preserve",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student-preserve",
            email="student-preserve@example.com",
            password="studentpass123",
            full_name="Student Preserve",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam = Exam(
        title="被修改但已提交的考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(hours=2),
        end_time=datetime.now(timezone.utc) + timedelta(hours=1),
        duration_minutes=90,
        total_score=100,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    original_started_at = datetime.now(timezone.utc) - timedelta(minutes=50)
    original_submitted_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    db_session.add(
        ExamStudent(
            exam_id=exam.id,
            student_id=student.id,
            started_at=original_started_at,
            submitted_at=original_submitted_at,
            score=91,
        )
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    patch_response = await client.patch(
        f"/api/exams/{exam.id}",
        json={
          "title": "被修改但已提交的考试（更新）",
          "student_ids": [str(student.id)],
        },
    )

    assert patch_response.status_code == 200
    assert patch_response.json()["students"][0]["submitted_at"] is not None

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    list_response = await client.get("/api/exams")

    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload[0]["title"] == "被修改但已提交的考试（更新）"
    assert payload[0]["started_at"] is not None
    assert payload[0]["submitted_at"] is not None
    assert payload[0]["score"] == 91


@pytest.mark.asyncio
async def test_updating_exam_does_not_remove_submitted_student_record_even_if_student_ids_is_empty(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-preserve-empty",
            email="teacher-preserve-empty@example.com",
            password="teacherpass123",
            full_name="Teacher Preserve Empty",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student-preserve-empty",
            email="student-preserve-empty@example.com",
            password="studentpass123",
            full_name="Student Preserve Empty",
            role_name="student",
            org_id=org.id,
        ),
    )

    exam = Exam(
        title="被修改后仍应保留提交记录的考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(hours=2),
        end_time=datetime.now(timezone.utc) + timedelta(hours=1),
        duration_minutes=90,
        total_score=100,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    db_session.add(
        ExamStudent(
            exam_id=exam.id,
            student_id=student.id,
            started_at=datetime.now(timezone.utc) - timedelta(minutes=40),
            submitted_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            score=86,
        )
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    patch_response = await client.patch(
        f"/api/exams/{exam.id}",
        json={
          "title": "被修改后仍应保留提交记录的考试（更新）",
          "student_ids": [],
        },
    )

    assert patch_response.status_code == 200
    assert len(patch_response.json()["students"]) == 1
    assert patch_response.json()["students"][0]["submitted_at"] is not None

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    list_response = await client.get("/api/exams")

    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload[0]["title"] == "被修改后仍应保留提交记录的考试（更新）"
    assert payload[0]["submitted_at"] is not None
    assert payload[0]["score"] == 86


@pytest.mark.asyncio
async def test_updating_exam_question_scores_updates_list_total_score(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher-score-sync",
            email="teacher-score-sync@example.com",
            password="teacherpass123",
            full_name="Teacher Score Sync",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    question_a = Question(
        type=QuestionType.CHOICE,
        title="原始 200 分题",
        content={"text": "A"},
        options={"A": "A", "B": "B"},
        answer={"correct": "A"},
        difficulty=1,
        score=200,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    question_b = Question(
        type=QuestionType.SHORT_ANSWER,
        title="原始 210 分题",
        content={"text": "B"},
        options=None,
        answer={"text": "B"},
        difficulty=1,
        score=210,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    exam = Exam(
        title="分数同步考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(hours=1),
        end_time=datetime.now(timezone.utc) + timedelta(hours=1),
        duration_minutes=60,
        total_score=410,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([question_a, question_b, exam])
    await db_session.flush()
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question_a.id, order=0, score_override=200),
            ExamQuestion(exam_id=exam.id, question_id=question_b.id, order=1, score_override=210),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    patch_response = await client.patch(
        f"/api/exams/{exam.id}",
        json={
            "question_items": [
                {"question_id": str(question_a.id), "order": 0, "score_override": 40},
                {"question_id": str(question_b.id), "order": 1, "score_override": 60},
            ],
        },
    )

    assert patch_response.status_code == 200
    assert patch_response.json()["total_score"] == 100

    list_response = await client.get("/api/exams")

    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload[0]["title"] == "分数同步考试"
    assert payload[0]["total_questions"] == 2
    assert payload[0]["total_score"] == 100
