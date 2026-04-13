from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Organization, Role, UserOrganization
from app.questions.schemas import QuestionImportDocumentRecognizeResponse
from app.questions.service import (
    build_import_draft_from_segment,
    detect_import_template_mode,
    parse_template_document,
    segment_question_document,
)


def test_document_recognize_response_exposes_review_metadata() -> None:
    payload = QuestionImportDocumentRecognizeResponse.model_validate(
        {
            "mode": "smart",
            "summary": {
                "total": 2,
                "high_confidence": 1,
                "medium_confidence": 1,
                "low_confidence": 0,
                "issue_count": 1,
                "pending_review": 2,
                "approved": 0,
                "skipped": 0,
            },
            "drafts": [
                {
                    "draft_id": "draft-1",
                    "raw_text": "1. 单选题 下列哪项...",
                    "title": "下列哪项...",
                    "type": "choice",
                    "content_text": "下列哪项...",
                    "options": {"A": "关系型数据库", "B": "缓存"},
                    "answer_text": "A",
                    "analysis": "",
                    "difficulty": 2,
                    "segment_source": "rule",
                    "type_confidence": "high",
                    "boundary_confidence": "high",
                    "issues": [],
                    "review_status": "pending",
                    "review_required": True,
                }
            ],
        }
    )

    assert payload.summary.pending_review == 2
    assert payload.drafts[0].review_required is True
    assert payload.drafts[0].review_status == "pending"


def test_detects_text_template_by_field_prefixes() -> None:
    raw_text = """
题型：单选题
题目内容：下列哪项属于关系型数据库？
答案：A
分析：MySQL 属于关系型数据库
难度：2
"""

    assert detect_import_template_mode(raw_text) == "template"


def test_detects_bracket_template_and_parses_every_question() -> None:
    raw_text = """
[题型] 选择题
题目内容：我国首都是哪里？
A. 北京
B. 上海
C. 广州
D. 深圳
[答案] A
[解析] 北京是中国首都。
[难度] 容易

[题型] 简答题
题目内容：请简述数据库事务的 ACID 特性。
[答案] 原子性、一致性、隔离性、持久性。
[解析] ACID 是数据库事务的四个核心特性。
[难度] 一般
"""

    assert detect_import_template_mode(raw_text) == "template"

    drafts = parse_template_document(raw_text)

    assert len(drafts) == 2
    assert drafts[0].type == "choice"
    assert drafts[0].options == {"A": "北京", "B": "上海", "C": "广州", "D": "深圳"}
    assert drafts[0].answer_text == "A"
    assert drafts[0].analysis == "北京是中国首都。"
    assert drafts[0].difficulty == 2
    assert drafts[0].issues == []
    assert drafts[0].content_text == "我国首都是哪里？"
    assert drafts[1].type == "short_answer"
    assert drafts[1].answer_text == "原子性、一致性、隔离性、持久性。"
    assert drafts[1].content_text == "请简述数据库事务的 ACID 特性。"


def test_segments_questions_by_numbering_and_type_keywords() -> None:
    raw_text = """
1. 单选题 下列哪项属于关系型数据库？
A. MySQL
B. Redis
答案：A

判断 下列说法是否正确：Redis 是关系型数据库。
答案：错误
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 2
    assert segments[0].raw_text.startswith("1.")
    assert segments[1].raw_text.startswith("判断")


def test_build_import_draft_recognizes_true_false_from_answer_tokens() -> None:
    draft = build_import_draft_from_segment(
        "判断 下列说法是否正确：Redis 是关系型数据库。\n答案：错误"
    )

    assert draft.type == "true_false"
    assert draft.answer_text == "错误"
    assert draft.type_confidence == "high"


def test_build_import_draft_marks_choice_with_missing_options_as_issue() -> None:
    draft = build_import_draft_from_segment(
        "1. 单选题 下列哪项属于关系型数据库？\nA. MySQL\n答案：A"
    )

    assert draft.type == "choice"
    assert "选择题选项不完整" in draft.issues


def test_build_import_draft_does_not_keep_standalone_question_type_in_content() -> None:
    draft = build_import_draft_from_segment(
        "选择题\n我国首都是哪里？\nA. 北京\nB. 上海\n答案：A"
    )

    assert draft.type == "choice"
    assert draft.content_text == "我国首都是哪里？"


async def test_document_recognize_endpoint_returns_pending_review_drafts(
    admin_client: AsyncClient,
) -> None:
    response = await admin_client.post(
        "/api/questions/import/document-recognize",
        json={
            "file_name": "questions.md",
            "source_format": "md",
            "raw_text": "1. 单选题 下列哪项属于关系型数据库？\nA. MySQL\nB. Redis\n答案：A",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "smart"
    assert data["drafts"][0]["review_status"] == "pending"
    assert data["drafts"][0]["review_required"] is True


async def test_document_recognize_endpoint_allows_school_admin_and_platform_admin(
    client: AsyncClient,
    db_session,
) -> None:
    async def build_role_client(role_name: str, username: str) -> AsyncClient:
        user = await create_user(
            db_session,
            UserCreate(
                username=username,
                email=f"{username}@example.com",
                password="pass123456",
                full_name=username,
            ),
        )
        org = Organization(name=f"{role_name} Org", type="school", is_active=True)
        db_session.add(org)
        await db_session.flush()

        role = Role(name=role_name, display_name=role_name, is_system=True)
        db_session.add(role)
        await db_session.flush()

        db_session.add(
            UserOrganization(
                user_id=user.id,
                org_id=org.id,
                role_id=role.id,
                is_primary=True,
            )
        )
        await db_session.commit()
        client.headers.update({"Authorization": f"Bearer {create_access_token(user.id, '')}"})
        return client

    for role_name in ("school_admin", "platform_admin"):
        role_client = await build_role_client(role_name, f"{role_name}_importer")
        response = await role_client.post(
            "/api/questions/import/document-recognize",
            json={
                "file_name": "questions.md",
                "source_format": "md",
                "raw_text": "[题型] 选择题\n题目内容：我国首都是哪里？\nA. 北京\nB. 上海\n[答案] A\n[难度] 容易",
            },
        )

        assert response.status_code == 200
        assert response.json()["mode"] == "template"
