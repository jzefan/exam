from io import BytesIO
import uuid

import pytest
from docx import Document
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.papers.models import PaperImportSession
from app.papers.schemas import PaperImportRecognizeRequest
from app.rbac.models import Organization, Role
from app.questions.schemas import (
    QuestionImportDocumentRecognizeResponse,
    QuestionImportDocumentSummary,
    QuestionImportDraft,
)


def test_paper_import_recognize_request_accepts_pdf_page_data_urls():
    page_image = "data:image/jpeg;base64," + ("a" * 300_000)

    payload = PaperImportRecognizeRequest.model_validate(
        {
            "file_name": "paper.pdf",
            "source_format": "pdf",
            "raw_text": "[IMAGE:page-1]",
            "images": [
                {
                    "image_id": "page-1",
                    "url": page_image,
                    "order": 1,
                    "page": 1,
                    "alt": "第 1 页",
                }
            ],
        }
    )

    assert payload.images[0].url == page_image


def test_standard_paper_rule_split_keeps_all_section_questions_and_internal_numbering():
    from app.questions.service import _build_standard_paper_drafts_from_text

    parts: list[str] = ["一、单项选择题（每小题 2 分，共 50 分）"]
    for number in range(1, 26):
        stem = f"{number}.单选题{number}（ ）"
        if number == 25:
            stem += "\n1.内部概念模式说明\n2.内部物理模式说明\n3.内部外模式说明"
        parts.append(f"{stem}\nA. 甲 B. 乙 C. 丙 D. 丁\n正确答案： A")

    parts.append("二、多选题（每题 2 分，共 10 分）")
    for number in range(1, 6):
        parts.append(f"{number}.多选题{number}（ ）\nA. 甲 B. 乙 C. 丙 D. 丁\n正确答案： AB")

    parts.append("三、填空题（每题 2 分，共 10 分）")
    for number in range(1, 6):
        parts.append(f"{number}.填空题{number}是 。\n正确答案： 答案{number}")

    parts.append("四、判断题（每小题 1 分，共 5 分）")
    for number in range(1, 6):
        parts.append(f"{number}.判断题{number}。（ ）\n正确答案： 正确")

    parts.append("五、简答题（每小题 5 分，共 25 分）")
    for number in range(1, 6):
        if number == 2:
            parts.append(f"\n[IMG:stem-er.png]\n{number}.简答题{number}\n正确答案： 要点{number}")
        elif number == 3:
            parts.append(f"\n[IMG:answer-er.png]\n{number}.简答题{number}")
        else:
            parts.append(f"{number}.简答题{number}\n正确答案： 要点{number}")

    drafts = _build_standard_paper_drafts_from_text(
        "\n".join(parts),
        {
            "stem-er.png": "/api/uploads/files/stem-er.png",
            "answer-er.png": "/api/uploads/files/answer-er.png",
        },
    )

    assert len(drafts) == 45
    assert [draft.type.value for draft in drafts].count("choice") == 30
    assert [draft.type.value for draft in drafts].count("fill_in") == 5
    assert [draft.type.value for draft in drafts].count("true_false") == 5
    assert [draft.type.value for draft in drafts].count("short_answer") == 5
    assert drafts[0].options == {"A": "甲", "B": "乙", "C": "丙", "D": "丁"}
    assert "选择题选项不完整" not in drafts[0].issues
    assert drafts[25].options == {"A": "甲", "B": "乙", "C": "丙", "D": "丁"}
    assert "选择题选项不完整" not in drafts[25].issues
    assert "内部概念模式说明" in drafts[24].content_text
    assert drafts[41].images[0].url == "/api/uploads/files/stem-er.png"
    assert drafts[42].images == []
    assert drafts[42].answer_images[0].url == "/api/uploads/files/answer-er.png"
    assert "未识别到答案" not in drafts[42].issues


def test_choice_options_split_when_multiple_options_share_one_line():
    from app.questions.service import build_import_draft_from_segment

    drafts = [
        build_import_draft_from_segment(
            "7.DBMS指的是以下哪个选项（ ）\n"
            "A. 数据库系统 B. 数据库信息系统 C. 数据库管理系统 D. 数据库开发系统\n"
            "正确答案： C",
            type_hint="单项选择题",
        ),
        build_import_draft_from_segment(
            "8.下面选项中，能够实现查询表中记录的关键字是（ ）\n"
            "A. DROP B.SELECT C.UPDATE D.DELETE\n"
            "正确答案： B",
            type_hint="单项选择题",
        ),
        build_import_draft_from_segment(
            "9.SQL 中用于删除表的命令是（ ） A. SELECT B. DROP C. UPDATE D. INSERT\n"
            "正确答案： B",
            type_hint="单项选择题",
        ),
    ]

    assert drafts[0].content_text == "DBMS指的是以下哪个选项（ ）"
    assert drafts[0].options == {
        "A": "数据库系统",
        "B": "数据库信息系统",
        "C": "数据库管理系统",
        "D": "数据库开发系统",
    }
    assert drafts[1].content_text == "下面选项中，能够实现查询表中记录的关键字是（ ）"
    assert drafts[1].options == {"A": "DROP", "B": "SELECT", "C": "UPDATE", "D": "DELETE"}
    assert drafts[2].content_text == "SQL 中用于删除表的命令是（ ）"
    assert drafts[2].options == {"A": "SELECT", "B": "DROP", "C": "UPDATE", "D": "INSERT"}
    assert all("选择题选项不完整" not in draft.issues for draft in drafts)


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


@pytest.mark.asyncio
async def test_paper_import_recognize_file_uses_pdf_chunked_recognizer(client, db_session, monkeypatch):
    teacher = await _teacher(db_session)
    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    calls: list[tuple[bytes, str]] = []

    async def fake_pdf_recognizer(
        file_bytes: bytes,
        file_name: str,
        recognition_prompt: str | None = None,
    ) -> QuestionImportDocumentRecognizeResponse:
        calls.append((file_bytes, file_name))
        assert recognition_prompt is None
        drafts = [
            QuestionImportDraft(
                draft_id="choice-1",
                raw_text="1. SQL 中用于查询的关键字是？",
                title="SQL 中用于查询的关键字是？",
                type="choice",
                content_text="SQL 中用于查询的关键字是？",
                options={"A": "SELECT", "B": "UPDATE"},
                answer_text="A",
                segment_source="pdf_chunked_ai",
                type_confidence="high",
                boundary_confidence="high",
            ),
            QuestionImportDraft(
                draft_id="fill-1",
                raw_text="26. SQL 语言中，数据查询语句是 _____。",
                title="SQL 语言中，数据查询语句是 _____。",
                type="fill_in",
                content_text="SQL 语言中，数据查询语句是 _____。",
                answer_text="SELECT",
                segment_source="pdf_chunked_ai",
                type_confidence="high",
                boundary_confidence="high",
                answer_images=[
                    {
                        "image_id": "answer-er.png",
                        "url": "/api/uploads/files/answer-er.png",
                        "order": 1,
                    }
                ],
            ),
        ]
        return QuestionImportDocumentRecognizeResponse(
            mode="smart",
            summary=QuestionImportDocumentSummary(
                total=2,
                high_confidence=2,
                medium_confidence=0,
                low_confidence=0,
                issue_count=0,
                pending_review=2,
                approved=0,
                skipped=0,
            ),
            drafts=drafts,
        )

    monkeypatch.setattr("app.papers.service.recognize_pdf_with_ai", fake_pdf_recognizer)

    response = await client.post(
        "/api/papers/import/recognize-file",
        files={"file": ("sql-paper.pdf", b"%PDF fake content", "application/pdf")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert calls == [(b"%PDF fake content", "sql-paper.pdf")]
    assert payload["summary"]["total"] == 2
    assert [draft["type"] for draft in payload["drafts"]] == ["choice", "fill_in"]
    assert payload["drafts"][1]["answer_images"][0]["url"] == "/api/uploads/files/answer-er.png"

    session = await db_session.get(PaperImportSession, uuid.UUID(payload["session_id"]))
    assert session is not None
    assert session.source_format == "pdf"
    assert session.preview_payload["summary"]["total"] == 2
    assert session.preview_payload["drafts"][1]["answer_images"][0]["image_id"] == "answer-er.png"
