from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion, ExamStudent
from app.questions.models import Question, QuestionType


@pytest.mark.asyncio
async def test_student_exam_flow(client: AsyncClient, db_session) -> None:
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher1",
            email="teacher1@example.com",
            password="teacherpass123",
            full_name="Teacher One",
            role_name="teacher",
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
    essay_question = Question(
        type=QuestionType.ESSAY,
        title="说明缓存雪崩的应对思路",
        content={"text": "<p>请说明缓存雪崩的常见应对思路。</p>"},
        options=None,
        answer={"points": ["设置随机过期时间", "多级缓存", "服务降级"]},
        analysis="从过期时间、隔离兜底和缓存架构三个角度作答。",
        difficulty=3,
        score=20,
        usage_count=0,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([choice_question, essay_question])
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
            ExamQuestion(exam_id=exam.id, question_id=essay_question.id, order=1),
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

    save_response = await client.post(
        f"/api/student/exams/{exam.id}/answers",
        json={
            "answers": [
                {"question_id": str(choice_question.id), "answer_content": {"selected": ["A"]}},
                {
                    "question_id": str(essay_question.id),
                    "answer_content": {"html": "<p>可以设置随机过期时间。</p>"},
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

    wrong_answers_response = await client.get("/api/wrong-answers")
    assert wrong_answers_response.status_code == 200
    wrong_answers = wrong_answers_response.json()
    assert len(wrong_answers) == 1
    wrong_item = wrong_answers[0]
    assert wrong_item["question_title"] == "说明缓存雪崩的应对思路"

    wrong_detail_response = await client.get(f"/api/wrong-answers/{wrong_item['id']}")
    assert wrong_detail_response.status_code == 200
    assert wrong_detail_response.json()["feedback"]["deductions"]

    mastered_response = await client.post(f"/api/wrong-answers/{wrong_item['id']}/mastered")
    assert mastered_response.status_code == 200
    assert mastered_response.json()["mastered"] is True

    appeal_response = await client.post(
        f"/api/student/exams/{exam.id}/appeals",
        json={
            "question_id": str(essay_question.id),
            "reason": "答案已覆盖两个核心要点，希望人工复核。",
        },
    )
    assert appeal_response.status_code == 201
    assert appeal_response.json()["status"] == "pending"


@pytest.mark.asyncio
async def test_student_can_submit_with_final_answers_after_exam_end(
    client: AsyncClient, db_session
) -> None:
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_submit_after_end",
            email="teacher_submit_after_end@example.com",
            password="teacherpass123",
            full_name="Teacher Submit After End",
            role_name="teacher",
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
