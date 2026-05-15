import pytest

from app.exams.student_router import _grade_question_with_ai
from app.questions.models import Question, QuestionType


def _build_fill_in_question(answer: dict[str, object]) -> Question:
    return Question(
        type=QuestionType.FILL_IN,
        title="Pandas 中聚合数据的三个函数分别是____、____、____。",
        content={"text": "Pandas 中聚合数据的三个函数分别是____、____、____。"},
        options=None,
        answer=answer,
        analysis=None,
        difficulty=2,
        score=9,
        usage_count=0,
        created_by="170050d5-f106-4427-b05e-b0bd92857491",
        owner_id="170050d5-f106-4427-b05e-b0bd92857491",
    )


@pytest.mark.asyncio
async def test_fill_in_grading_scores_by_blank_count_with_local_normalization() -> None:
    question = _build_fill_in_question({"correct": ["groupby", "agg", "transform"]})

    score, correct, feedback = await _grade_question_with_ai(
        question,
        {"blanks": ["groupby", "agg.", ""]},
        9,
    )

    assert score == 6
    assert correct is False
    assert feedback["dimensions"][0]["comment"] == "共命中 2/3 个空。"
    assert feedback["deductions"] == ["第 3 空应为 transform"]


@pytest.mark.asyncio
async def test_fill_in_grading_uses_deepseek_equivalence_for_disputed_blanks(monkeypatch) -> None:
    async def fake_ai(*, question_text, expected_answers, student_answers):
        assert "Pandas" in question_text
        assert expected_answers == ["groupby", "agg", "transform"]
        assert student_answers == ["group by", "apply", "transform"]
        return [
            {"is_correct": True, "reason": "group by 与 groupby 表达同一 Pandas 方法。"},
            {"is_correct": False, "reason": "apply 不是标准答案中的 agg。"},
            {"is_correct": True, "reason": "完全一致。"},
        ]

    monkeypatch.setattr("app.exams.student_router._request_fill_in_equivalence_with_deepseek", fake_ai)
    question = _build_fill_in_question({"correct": ["groupby", "agg", "transform"]})

    score, correct, feedback = await _grade_question_with_ai(
        question,
        {"blanks": ["group by", "apply", "transform"]},
        9,
    )

    assert score == 6
    assert correct is False
    assert feedback["dimensions"][0]["comment"] == "共命中 2/3 个空。"
    assert feedback["deductions"] == ["第 2 空应为 agg"]
    assert "DeepSeek 判定第 1 空等价：group by 与 groupby 表达同一 Pandas 方法。" in feedback["strengths"]
