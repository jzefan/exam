from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.exams.models import Exam, ExamStudent
from app.learning.models import KnowledgePoint
from app.rbac.models import Class, Organization, Role, TeacherStudent
from app.teacher_courses.models import (
    CourseGradeWeight,
    CourseSemester,
    ExamSemesterAssignment,
)


@pytest.mark.asyncio
async def test_course_gradebook_combines_system_scores_and_manual_overrides(
    client: AsyncClient,
    db_session,
) -> None:
    org = Organization(name="Gradebook School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, teacher_role, student_role])
    await db_session.flush()

    teacher = await create_user(
        db_session,
        UserCreate(
            username="gradebook-teacher",
            email="gradebook-teacher@example.com",
            password="teacherpass123",
            full_name="Gradebook Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="gradebook-student",
            email="gradebook-student@example.com",
            password="studentpass123",
            full_name="Gradebook Student",
            role_name="student",
            org_id=org.id,
        ),
    )
    student.student_id = "S2026001"

    class_row = Class(name="Python 1 班", org_id=org.id, created_by=teacher.id)
    course = KnowledgePoint(
        name="Python 程序设计",
        parent_id=None,
        description=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([class_row, course])
    await db_session.flush()
    student.class_id = class_row.id
    db_session.add(TeacherStudent(teacher_id=teacher.id, student_id=student.id))

    semester = CourseSemester(
        course_id=course.id,
        name="2026 春季",
        class_ids=[str(class_row.id)],
        owner_id=teacher.id,
    )
    weights = CourseGradeWeight(
        course_id=course.id,
        weights={
            "chapter_task": 20,
            "chapter_quiz": 20,
            "assignment": 30,
            "exam": 30,
        },
    )
    db_session.add_all([semester, weights])
    await db_session.flush()

    now = datetime.now(timezone.utc)
    practice = Exam(
        category="practice",
        title="章节练习",
        start_time=now - timedelta(days=2),
        end_time=now + timedelta(days=2),
        duration_minutes=60,
        total_score=100,
        status="ongoing",
        course_kp_id=course.id,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    exam = Exam(
        category="exam",
        title="期中考试",
        start_time=now - timedelta(days=2),
        end_time=now + timedelta(days=2),
        duration_minutes=60,
        total_score=100,
        status="ongoing",
        course_kp_id=course.id,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([practice, exam])
    await db_session.flush()
    db_session.add_all(
        [
            ExamSemesterAssignment(exam_id=practice.id, course_semester_id=semester.id),
            ExamSemesterAssignment(exam_id=exam.id, course_semester_id=semester.id),
            ExamStudent(
                exam_id=practice.id,
                student_id=student.id,
                score=80,
                submitted_at=now,
            ),
            ExamStudent(
                exam_id=exam.id,
                student_id=student.id,
                score=90,
                submitted_at=now,
            ),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})

    response = await client.get(
        f"/api/teacher/courses/{course.id}/grade-summary?semester_id={semester.id}"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["student_count"] == 1
    assert payload["students"][0]["assignment"]["score"] == 80
    assert payload["students"][0]["exam"]["score"] == 90
    assert payload["students"][0]["comprehensive_score"] == 51

    update_response = await client.put(
        f"/api/teacher/courses/{course.id}/grade-summary/{student.id}",
        json={
            "semester_id": str(semester.id),
            "component": "chapter_task",
            "score": 70,
        },
    )
    assert update_response.status_code == 200

    refreshed = await client.get(
        f"/api/teacher/courses/{course.id}/grade-summary?semester_id={semester.id}"
    )
    assert refreshed.status_code == 200
    refreshed_student = refreshed.json()["students"][0]
    assert refreshed_student["chapter_task"]["source"] == "manual"
    assert refreshed_student["chapter_task"]["score"] == 70
    assert refreshed_student["comprehensive_score"] == 65
