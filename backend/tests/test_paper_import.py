from io import BytesIO

import pytest
from docx import Document
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Organization, Role


async def _teacher(db_session):
    org = Organization(name="Import Org", type="school", is_active=True)
    role = await db_session.scalar(select(Role).where(Role.name == "teacher"))
    if role is None:
        role = Role(name="teacher", display_name="Teacher", is_system=True)
        db_session.add(role)
    db_session.add(org)
    await db_session.flush()
    return await create_user(
        db_session,
        UserCreate(
            username="paper-import-teacher",
            email="paper-import-teacher@example.com",
            password="teacherpass123",
            full_name="Import Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )


@pytest.mark.asyncio
async def test_paper_import_recognize_and_confirm_creates_paper(client, db_session):
    teacher = await _teacher(db_session)
    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})

    recognize_response = await client.post(
        "/api/papers/import/recognize",
        json={
            "file_name": "history.md",
            "source_format": "md",
            "root_knowledge_point_id": None,
            "raw_text": "1. 单选题 MySQL 属于哪类数据库？\nA. 关系型\nB. 缓存\n答案：A",
            "images": [],
        },
    )
    assert recognize_response.status_code == 200
    recognized = recognize_response.json()
    assert recognized["session_id"]
    assert recognized["drafts"]

    draft = recognized["drafts"][0]
    draft["review_status"] = "approved"
    confirm_response = await client.post(
        f"/api/papers/import/sessions/{recognized['session_id']}/confirm",
        json={
            "title": "导入历史试卷",
            "description": None,
            "root_knowledge_point_id": None,
            "drafts": [draft],
        },
    )
    assert confirm_response.status_code == 201
    payload = confirm_response.json()
    assert payload["title"] == "导入历史试卷"
    assert payload["source_type"] == "import"
    assert payload["question_count"] == 1

    session_response = await client.get(f"/api/papers/import/sessions/{recognized['session_id']}")
    assert session_response.status_code == 200
    assert session_response.json()["created_paper_id"] == payload["id"]
    assert session_response.json()["error_detail"] is None


@pytest.mark.asyncio
async def test_paper_import_recognize_file_extracts_docx_tables(client, db_session, monkeypatch):
    teacher = await _teacher(db_session)
    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})

    async def fake_request(_prompt: str) -> dict:
        return {
            "questions": [
                {
                    "type": "choice",
                    "content_text": "下面关于数据分析说法正确的是？",
                    "options": {"A": "只做统计", "B": "服务决策", "C": "无需清洗", "D": "不能可视化"},
                    "answer_text": "B",
                    "analysis": "",
                    "difficulty": 3,
                    "raw_text": "下面关于数据分析说法正确的是？",
                    "images": [],
                }
            ]
        }

    monkeypatch.setattr("app.questions.service._request_deepseek_json", fake_request)

    doc = Document()
    doc.add_paragraph("江苏卫生健康职业学院 2024-2025 学年试卷")
    table = doc.add_table(rows=5, cols=2)
    rows = [
        ("题号", "1"),
        ("题干", "下面关于数据分析说法正确的是？"),
        ("选项", "A. 只做统计\nB. 服务决策\nC. 无需清洗\nD. 不能可视化"),
        ("答案", "B"),
        ("解析", "数据分析用于支持业务决策。"),
    ]
    for index, (label, value) in enumerate(rows):
        table.rows[index].cells[0].text = label
        table.rows[index].cells[1].text = value
    buffer = BytesIO()
    doc.save(buffer)

    response = await client.post(
        "/api/papers/import/recognize-file",
        files={
            "file": (
                "数据分析试卷.docx",
                buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
        data={"prompt": "请严格按试卷题目识别，不要把表头当题目。"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["session_id"]
    assert payload["summary"]["total"] == 1
    assert payload["drafts"][0]["content_text"] == "下面关于数据分析说法正确的是？"
