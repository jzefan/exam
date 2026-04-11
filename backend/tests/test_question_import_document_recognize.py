from httpx import AsyncClient

from app.questions.schemas import QuestionImportDocumentRecognizeResponse
from app.questions.service import (
    build_import_draft_from_segment,
    detect_import_template_mode,
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
