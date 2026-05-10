import io
from pathlib import Path

import pytest

from app.questions.docx_render import extract_docx_structured_blocks, DocxStructuredBlock


def _read_test_docx() -> bytes:
    test_path = Path(__file__).parent.parent.parent / "docs" / "bigdata-A试卷-印刷.docx"
    if not test_path.exists():
        pytest.skip("Test DOCX file not available")
    return test_path.read_bytes()


def test_extract_docx_reconstructs_numbering_for_word_list_paragraphs() -> None:
    blocks = extract_docx_structured_blocks(io.BytesIO(_read_test_docx()))

    # Q1 stem should be reconstructed with "1." prefix
    q1 = next(
        b for b in blocks if "下面关于数据分析说法正确的是" in b.text
    )
    assert q1.text.startswith("1.")
    assert isinstance(q1.bold, bool)
    assert q1.style is not None

    # Options A/B/C/D for Q1 should be separate blocks
    option_texts = [
        b.text for b in blocks if b.text.strip().startswith(("A.", "B.", "C.", "D."))
    ]
    assert len(option_texts) >= 4


def test_extract_docx_expands_soft_breaks_into_separate_lines() -> None:
    blocks = extract_docx_structured_blocks(io.BytesIO(_read_test_docx()))

    # Questions 11-16 use soft-breaks; they must NOT collapse into one line
    q11 = next(
        b for b in blocks if "下列关于pandas数据读写说法正确的是" in b.text
    )
    assert "下列关于pandas数据读写" in q11.text
    # The block should not also contain Q12 stem merged in
    assert "下列关于pandas基本操作" not in q11.text


def test_render_docx_pages_produces_valid_jpeg_data_urls() -> None:
    from app.questions.docx_render import extract_docx_structured_blocks, render_docx_pages

    file_bytes = io.BytesIO(_read_test_docx())
    blocks = extract_docx_structured_blocks(file_bytes)
    page_urls = render_docx_pages(blocks)

    assert len(page_urls) >= 1
    for url in page_urls:
        assert url.startswith("data:image/jpeg;base64,")
        import base64
        raw = base64.b64decode(url.split(",", 1)[1])
        assert len(raw) > 1000
        assert raw[:2] == b"\xff\xd8"


@pytest.mark.asyncio
async def test_visual_recognize_endpoint_accepts_docx_file(admin_client, monkeypatch) -> None:
    async def fake_vision(*, provider_name, api_key, base_url, model_name, prompt, images):
        return {
            "questions": [
                {
                    "type": "choice",
                    "content_text": "下面关于数据分析说法正确的是",
                    "options": {"A": "数据分析是数学...", "B": "数据分析是一种数学分析方法"},
                    "answer_text": "A",
                    "analysis": "",
                    "difficulty": 2,
                    "raw_text": "1. 下面关于数据分析说法正确的是(   )",
                    "images": [],
                }
            ]
        }

    monkeypatch.setattr("app.questions.docx_render._request_vision_json", fake_vision)

    response = await admin_client.post(
        "/api/questions/import/document-recognize-visual",
        files={"file": ("test.docx", io.BytesIO(_read_test_docx()), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "visual"
    assert len(data["drafts"]) >= 1
    assert data["drafts"][0]["type"] == "choice"
