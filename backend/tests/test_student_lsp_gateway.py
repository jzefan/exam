from datetime import datetime, timedelta, timezone
import uuid
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.exams.models import Exam, ExamQuestion, ExamStudent
from app.main import app
from app.questions.models import Question, QuestionType
from app.rbac.models import Organization, Role


async def _create_org_with_roles(db_session):
    org = Organization(name="Student LSP School", type="school", is_active=True)
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
        description=f"{title} LSP 测试",
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
            ExamStudent(
                exam_id=exam.id,
                student_id=student_id,
                started_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            ),
        ]
    )
    await db_session.commit()
    return exam


@pytest.mark.asyncio
async def test_student_lsp_gateway_proxies_valid_code_question(monkeypatch: pytest.MonkeyPatch, db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_lsp_gateway",
            email="teacher_lsp_gateway@example.com",
            password="teacherpass123",
            full_name="Teacher LSP Gateway",
            role_name="teacher",
            org_id=org.id,
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_lsp_gateway",
            email="student_lsp_gateway@example.com",
            password="studentpass123",
            full_name="Student LSP Gateway",
            role_name="student",
            org_id=org.id,
        ),
    )
    question = Question(
        type=QuestionType.CODE,
        title="LSP 代码题",
        content={"mode": "program", "text": "<p>读取输入并输出。</p>"},
        options=None,
        answer={"points": ["读取输入", "输出结果"]},
        analysis="",
        difficulty=1,
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
        title="LSP 网关考试",
    )

    captured: dict[str, object] = {}

    async def fake_proxy(websocket, runner_url, session):
        captured["runner_url"] = runner_url
        captured["session"] = session
        await websocket.accept()
        await websocket.send_json({"type": "ready", "language": session.language})
        await websocket.close()

    @asynccontextmanager
    async def fake_async_session():
        yield db_session

    monkeypatch.setattr("app.exams.student_router.proxy_lsp_websocket", fake_proxy)
    monkeypatch.setattr("app.exams.student_router.settings.lsp_runner_url", "http://lsp-runner:8020")
    monkeypatch.setattr("app.exams.student_router.async_session", fake_async_session)

    token = create_access_token(student.id, "")

    client = TestClient(app)
    try:
        with client.websocket_connect(
            f"/api/student/exams/{exam.id}/questions/{question.id}/lsp?language=python",
            headers={"Authorization": f"Bearer {token}"},
        ) as websocket:
            message = websocket.receive_json()
    finally:
        client.close()

    assert message == {"type": "ready", "language": "python"}
    assert captured["runner_url"] == "http://lsp-runner:8020"
    session = captured["session"]
    assert session.student_id == student.id
    assert session.exam_id == exam.id
    assert session.question_id == question.id
    assert session.language == "python"


@pytest.mark.asyncio
async def test_student_lsp_gateway_rejects_invalid_token(monkeypatch: pytest.MonkeyPatch, db_session) -> None:
    @asynccontextmanager
    async def fake_async_session():
        yield db_session

    monkeypatch.setattr("app.exams.student_router.async_session", fake_async_session)

    client = TestClient(app)
    try:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(
                f"/api/student/exams/{uuid.uuid4()}/questions/{uuid.uuid4()}/lsp?language=python",
                headers={"Authorization": "Bearer invalid-token"},
            ):
                pass
    finally:
        client.close()

    assert exc_info.value.code == 1008
