from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from sqlalchemy import select

from app.exams.models import Exam, ExamQuestion, ExamStudent, StudentExamSubmission, StudentExamSubmissionAnswer
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role


async def _create_org_with_roles(db_session):
    org = Organization(name="Student Flow School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, teacher_role, student_role])
    await db_session.flush()
    return org


@pytest.mark.asyncio
async def test_student_exam_flow(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher1",
            email="teacher1@example.com",
            password="teacherpass123",
            full_name="Teacher One",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student1",
            email="student1@example.com",
            password="studentpass123",
            full_name="Student One",
            role_name="student",
            org_id=org.id,
        ),
    )

    choice_question = Question(
        type=QuestionType.CHOICE,
        title="TCP 三次握手第一步是什么？",
        content={"text": "<p>TCP 三次握手第一步是什么？</p>"},
        options={"A": "客户端发送 SYN", "B": "服务端返回 ACK"},
        answer={"correct": "A"},
        analysis="先由客户端发起 SYN 建立连接。",
        difficulty=2,
        score=10,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    fill_in_question = Question(
        type=QuestionType.FILL_IN,
        title="说明缓存雪崩的应对思路",
        content={"text": "<p>请说明缓存雪崩的常见应对思路。</p>"},
        options=None,
        answer={"blanks": ["设置随机过期时间", "多级缓存", "服务降级"]},
        analysis="从过期时间、隔离兜底和缓存架构三个角度作答。",
        difficulty=3,
        score=20,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([choice_question, fill_in_question])
    await db_session.flush()

    exam = Exam(
        title="系统设计测验",
        description="学生端考试流程集成测试",
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=30,
        status="ongoing",
        max_switch_count=2,
        show_result=True,
        notes_template="<p>请诚信作答。</p>",
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=choice_question.id, order=0),
            ExamQuestion(exam_id=exam.id, question_id=fill_in_question.id, order=1),
            ExamStudent(exam_id=exam.id, student_id=student.id),
        ]
    )
    await db_session.commit()

    student_token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {student_token}"})

    list_response = await client.get("/api/exams")
    assert list_response.status_code == 200
    exams = list_response.json()
    assert len(exams) == 1
    assert exams[0]["title"] == "系统设计测验"
    assert exams[0]["participated"] is False

    start_response = await client.post(f"/api/student/exams/{exam.id}/start")
    assert start_response.status_code == 200
    start_data = start_response.json()
    assert len(start_data["questions"]) == 2
    fill_in_payload = next(question for question in start_data["questions"] if question["type"] == "fill_in")
    assert fill_in_payload["content"]["blank_count"] == 3

    save_response = await client.post(
        f"/api/student/exams/{exam.id}/answers",
        json={
            "answers": [
                {"question_id": str(choice_question.id), "answer_content": {"selected": ["A"]}},
                {
                    "question_id": str(fill_in_question.id),
                    "answer_content": {"blanks": ["设置随机过期时间"]},
                },
            ]
        },
    )
    assert save_response.status_code == 200

    switch_response = await client.post(
        f"/api/student/exams/{exam.id}/switch",
        json={"switch_count": 1},
    )
    assert switch_response.status_code == 200
    assert switch_response.json()["force_submit"] is False

    submit_response = await client.post(f"/api/student/exams/{exam.id}/submit")
    assert submit_response.status_code == 200
    assert submit_response.json()["submitted"] is True

    result_response = await client.get(f"/api/student/exams/{exam.id}/result")
    assert result_response.status_code == 200
    result_data = result_response.json()
    assert result_data["can_view"] is True
    assert len(result_data["questions"]) == 2
    assert result_data["score"] is not None

    appeal_response = await client.post(
        f"/api/student/exams/{exam.id}/appeals",
        json={
            "question_id": str(fill_in_question.id),
            "reason": "答案已覆盖两个核心要点，希望人工复核。",
        },
    )
    assert appeal_response.status_code == 201
    assert appeal_response.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_student_can_submit_with_final_answers_after_exam_end(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_submit_after_end",
            email="teacher_submit_after_end@example.com",
            password="teacherpass123",
            full_name="Teacher Submit After End",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_submit_after_end",
            email="student_submit_after_end@example.com",
            password="studentpass123",
            full_name="Student Submit After End",
            role_name="student",
            org_id=org.id,
        ),
    )

    choice_question = Question(
        type=QuestionType.CHOICE,
        title="网络分层题",
        content={"text": "<p>OSI 共有几层？</p>"},
        options={"A": "5", "B": "7"},
        answer={"correct": "B"},
        analysis="OSI 七层模型。",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(choice_question)
    await db_session.flush()

    exam = Exam(
        title="已结束补提交考试",
        description="验证考试结束后仍可随最终提交携带答案",
        start_time=datetime.now(timezone.utc) - timedelta(minutes=20),
        end_time=datetime.now(timezone.utc) - timedelta(seconds=5),
        duration_minutes=10,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()

    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=choice_question.id, order=0),
            ExamStudent(exam_id=exam.id, student_id=student.id),
        ]
    )
    await db_session.commit()

    student_token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {student_token}"})

    submit_response = await client.post(
        f"/api/student/exams/{exam.id}/submit",
        json={
            "answers": [
                {
                    "question_id": str(choice_question.id),
                    "answer_content": {"selected": ["B"]},
                }
            ]
        },
    )

    assert submit_response.status_code == 200
    assert submit_response.json()["submitted"] is True


@pytest.mark.asyncio
async def test_student_can_retake_ongoing_exam_when_teacher_allows_it_and_history_is_preserved(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_resubmit_flow",
            email="teacher_resubmit_flow@example.com",
            password="teacherpass123",
            full_name="Teacher Resubmit",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_resubmit_flow",
            email="student_resubmit_flow@example.com",
            password="studentpass123",
            full_name="Student Resubmit",
            role_name="student",
            org_id=org.id,
        ),
    )

    choice_question = Question(
        type=QuestionType.CHOICE,
        title="哪一个选项是正确答案？",
        content={"text": "<p>请选择正确答案。</p>"},
        options={"A": "错误", "B": "正确"},
        answer={"correct": "B"},
        analysis="正确答案是 B。",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(choice_question)
    await db_session.flush()

    exam = Exam(
        title="进行中可重交考试",
        description="验证进行中考试允许再次提交",
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        allow_retake=True,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=choice_question.id, order=0),
            ExamStudent(exam_id=exam.id, student_id=student.id),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})

    first_submit = await client.post(
        f"/api/student/exams/{exam.id}/submit",
        json={
            "answers": [
                {"question_id": str(choice_question.id), "answer_content": {"selected": ["A"]}},
            ]
        },
    )
    assert first_submit.status_code == 200
    assert first_submit.json()["score"] == 0

    restart = await client.post(f"/api/student/exams/{exam.id}/start", json={"retake": True})
    assert restart.status_code == 200
    assert restart.json()["saved_answers"] == {}

    second_save = await client.post(
        f"/api/student/exams/{exam.id}/answers",
        json={
            "answers": [
                {"question_id": str(choice_question.id), "answer_content": {"selected": ["B"]}},
            ]
        },
    )
    assert second_save.status_code == 200

    second_submit = await client.post(f"/api/student/exams/{exam.id}/submit")
    assert second_submit.status_code == 200
    assert second_submit.json()["submitted"] is True
    assert second_submit.json()["score"] == 5

    result_response = await client.get(f"/api/student/exams/{exam.id}/result")
    assert result_response.status_code == 200
    result_payload = result_response.json()
    assert result_payload["score"] == 5
    assert result_payload["questions"][0]["answer_content"] == {"selected": ["B"]}

    exam_student = (
        await db_session.execute(
            select(ExamStudent).where(ExamStudent.exam_id == exam.id, ExamStudent.student_id == student.id)
        )
    ).scalar_one()
    assert exam_student.score == 5
    assert exam_student.saved_answers[str(choice_question.id)] == {"selected": ["B"]}
    assert exam_student.latest_submission_id is not None
    assert exam_student.submission_count == 2

    submissions = (
        await db_session.execute(
            select(StudentExamSubmission)
            .where(StudentExamSubmission.exam_id == exam.id, StudentExamSubmission.student_id == student.id)
            .order_by(StudentExamSubmission.attempt_no.asc())
        )
    ).scalars().all()
    assert [submission.attempt_no for submission in submissions] == [1, 2]
    assert [submission.score for submission in submissions] == [0, 5]

    submission_answers = (
        await db_session.execute(
            select(StudentExamSubmissionAnswer)
                .where(StudentExamSubmissionAnswer.submission_id.in_([submission.id for submission in submissions]))
        )
    ).scalars().all()
    assert len(submission_answers) == 2
    answers_by_submission_id = {
        str(item.submission_id): item.answer_content for item in submission_answers
    }
    assert answers_by_submission_id[str(submissions[0].id)] == {"selected": ["A"]}
    assert answers_by_submission_id[str(submissions[1].id)] == {"selected": ["B"]}


@pytest.mark.asyncio
async def test_student_cannot_retake_ongoing_exam_without_teacher_permission(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_no_retake",
            email="teacher_no_retake@example.com",
            password="teacherpass123",
            full_name="Teacher No Retake",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_no_retake",
            email="student_no_retake@example.com",
            password="studentpass123",
            full_name="Student No Retake",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="重考限制",
        content={"text": "<p>请选择正确答案。</p>"},
        options={"A": "错误", "B": "正确"},
        answer={"correct": "B"},
        analysis="正确答案是 B。",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = Exam(
        title="不允许重考考试",
        description=None,
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=50),
        duration_minutes=60,
        total_score=5,
        status="ongoing",
        max_switch_count=0,
        allow_retake=False,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(exam)
    await db_session.flush()
    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            ExamStudent(exam_id=exam.id, student_id=student.id),
        ]
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(student.id, '')}"})
    first_submit = await client.post(
        f"/api/student/exams/{exam.id}/submit",
        json={"answers": [{"question_id": str(question.id), "answer_content": {"selected": ["B"]}}]},
    )
    assert first_submit.status_code == 200

    restart = await client.post(f"/api/student/exams/{exam.id}/start", json={"retake": True})
    assert restart.status_code == 400
    assert restart.json()["detail"] == "Retake is not allowed"
