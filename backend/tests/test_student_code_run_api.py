from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.code_runner.schemas import CodeRunResult, CodeRunStatus
from app.exams.models import Exam, ExamQuestion, ExamStudent
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role


async def _create_org_with_roles(db_session):
    org = Organization(name="Student Code Run School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, teacher_role, student_role])
    await db_session.flush()
    return org


async def _create_exam_with_assignment(
    db_session,
    *,
    teacher_id,
    student_id,
    question: Question,
    title: str,
) -> Exam:
    exam = Exam(
        title=title,
        description=f"{title} 接口测试",
        start_time=datetime.now(timezone.utc) - timedelta(minutes=10),
        end_time=datetime.now(timezone.utc) + timedelta(minutes=30),
        duration_minutes=60,
        total_score=question.score,
        status="ongoing",
        max_switch_count=0,
        show_result=True,
        created_by=teacher_id,
        owner_id=teacher_id,
    )
    db_session.add(exam)
    await db_session.flush()

    db_session.add_all(
        [
            ExamQuestion(exam_id=exam.id, question_id=question.id, order=0),
            ExamStudent(exam_id=exam.id, student_id=student_id),
        ]
    )
    await db_session.commit()
    return exam


@pytest.mark.asyncio
async def test_student_can_run_code_question_in_sample_mode(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_code_run",
            email="teacher_code_run@example.com",
            password="teacherpass123",
            full_name="Teacher Code Run",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_code_run",
            email="student_code_run@example.com",
            password="studentpass123",
            full_name="Student Code Run",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.CODE,
        title="实现两个数求和",
        content={
            "text": "<p>读取两个整数并输出它们的和。</p>",
            "sample_tests": [
                {
                    "name": "示例 1",
                    "input": "1 2\n",
                    "expected_output": "3\n",
                    "is_public": True,
                }
            ],
        },
        options=None,
        answer={"points": ["读取输入", "输出结果"]},
        analysis="输出两个整数之和。",
        difficulty=2,
        score=10,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = await _create_exam_with_assignment(
        db_session,
        teacher_id=teacher.id,
        student_id=student.id,
        question=question,
        title="代码调试考试",
    )

    student_token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {student_token}"})

    start_response = await client.post(f"/api/student/exams/{exam.id}/start")
    assert start_response.status_code == 200

    response = await client.post(
        f"/api/student/exams/{exam.id}/questions/{question.id}/run",
        json={
            "language": "python",
            "code": "a, b = map(int, input().split())\nprint(a + b)",
            "mode": "sample",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "sample"
    assert data["language"] == "python"
    assert data["status"] in {"passed", "failed"}
    assert data["case_count"] == 1
    assert data["cases"][0]["name"] == "示例 1"


@pytest.mark.asyncio
async def test_student_cannot_run_non_code_question(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_non_code_run",
            email="teacher_non_code_run@example.com",
            password="teacherpass123",
            full_name="Teacher Non Code Run",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_non_code_run",
            email="student_non_code_run@example.com",
            password="studentpass123",
            full_name="Student Non Code Run",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.CHOICE,
        title="HTTP 状态码",
        content={"text": "<p>200 表示什么？</p>"},
        options={"A": "成功", "B": "失败"},
        answer={"correct": "A"},
        analysis="200 表示请求成功。",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = await _create_exam_with_assignment(
        db_session,
        teacher_id=teacher.id,
        student_id=student.id,
        question=question,
        title="非代码题考试",
    )

    student_token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {student_token}"})

    start_response = await client.post(f"/api/student/exams/{exam.id}/start")
    assert start_response.status_code == 200

    response = await client.post(
        f"/api/student/exams/{exam.id}/questions/{question.id}/run",
        json={
            "language": "python",
            "code": "print('ok')",
            "mode": "sample",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Question is not a code question"


@pytest.mark.asyncio
async def test_student_cannot_run_code_question_before_start_or_after_submit(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_attempt_state",
            email="teacher_attempt_state@example.com",
            password="teacherpass123",
            full_name="Teacher Attempt State",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_attempt_state",
            email="student_attempt_state@example.com",
            password="studentpass123",
            full_name="Student Attempt State",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.CODE,
        title="实现回显",
        content={
            "text": "<p>读取输入并原样输出。</p>",
            "sample_tests": [
                {
                    "name": "示例 1",
                    "input": "hello\n",
                    "expected_output": "hello\n",
                    "is_public": True,
                }
            ],
        },
        options=None,
        answer={"points": ["读取输入", "输出结果"]},
        analysis="原样输出输入内容。",
        difficulty=1,
        score=5,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = await _create_exam_with_assignment(
        db_session,
        teacher_id=teacher.id,
        student_id=student.id,
        question=question,
        title="考试作答状态检查",
    )
    exam_id = str(exam.id)
    question_id = str(question.id)

    student_token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {student_token}"})

    before_start = await client.post(
        f"/api/student/exams/{exam_id}/questions/{question_id}/run",
        json={
            "language": "python",
            "code": "print(input())",
            "mode": "sample",
        },
    )
    assert before_start.status_code == 400
    assert before_start.json()["detail"] == "Exam not started"

    start_response = await client.post(f"/api/student/exams/{exam_id}/start")
    assert start_response.status_code == 200

    exam_student = (
        await db_session.execute(
            select(ExamStudent).where(
                ExamStudent.exam_id == exam.id,
                ExamStudent.student_id == student.id,
            )
        )
    ).scalar_one()
    exam_student.submitted_at = datetime.now(timezone.utc)
    await db_session.commit()

    after_submit = await client.post(
        f"/api/student/exams/{exam_id}/questions/{question_id}/run",
        json={
            "language": "python",
            "code": "print(input())",
            "mode": "sample",
        },
    )
    assert after_submit.status_code == 400
    assert after_submit.json()["detail"] == "Exam already submitted"


@pytest.mark.asyncio
async def test_student_code_run_uses_judge_runner_when_configured(
    monkeypatch: pytest.MonkeyPatch, client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)

    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_judge_runner",
            email="teacher_judge_runner@example.com",
            password="teacherpass123",
            full_name="Teacher Judge Runner",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_judge_runner",
            email="student_judge_runner@example.com",
            password="studentpass123",
            full_name="Student Judge Runner",
            role_name="student",
            org_id=org.id,
        ),
    )

    question = Question(
        type=QuestionType.CODE,
        title="judge runner 代码题",
        content={
            "mode": "program",
            "text": "<p>读取两个整数并输出它们的和。</p>",
            "sample_tests": [
                {
                    "name": "示例 1",
                    "input": "1 2\n",
                    "expected_output": "3\n",
                    "is_public": True,
                }
            ],
        },
        options=None,
        answer={"points": ["读取输入", "输出结果"]},
        analysis="输出两个整数之和。",
        difficulty=2,
        score=10,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add(question)
    await db_session.flush()

    exam = await _create_exam_with_assignment(
        db_session,
        teacher_id=teacher.id,
        student_id=student.id,
        question=question,
        title="judge-runner 考试",
    )

    called = {"value": False}

    async def fake_run(base_url, request, sample_tests):
        called["value"] = True
        assert base_url == "http://judge_runner:8010"
        assert request.language == "python"
        assert len(sample_tests) == 1
        return CodeRunResult(
            status=CodeRunStatus.PASSED,
            mode=request.mode,
            language=request.language,
            stdout="3\n",
            stderr="",
            compile_output="",
            time_ms=1,
            memory_kb=0,
            case_count=1,
            passed_count=1,
            cases=[],
        )

    monkeypatch.setattr("app.exams.student_router.settings.judge_runner_url", "http://judge_runner:8010")
    monkeypatch.setattr("app.exams.student_router.run_code_via_judge_runner", fake_run)

    student_token = create_access_token(student.id, "")
    client.headers.update({"Authorization": f"Bearer {student_token}"})

    start_response = await client.post(f"/api/student/exams/{exam.id}/start")
    assert start_response.status_code == 200

    response = await client.post(
        f"/api/student/exams/{exam.id}/questions/{question.id}/run",
        json={
            "language": "python",
            "code": "a, b = map(int, input().split())\nprint(a + b)",
            "mode": "sample",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "passed"
    assert called["value"] is True
