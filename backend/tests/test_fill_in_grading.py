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


@pytest.mark.asyncio
async def test_fill_in_grading_treats_equivalent_latex_forms_as_correct() -> None:
    question = _build_fill_in_question(
        {
            "correct": [
                r"\frac{f^{(n+1)}(\xi)}{(n+1)!}(x-x_0)^{n+1}，其中 \xi 介于 x 与 x_0 之间",
            ]
        }
    )

    score, correct, feedback = await _grade_question_with_ai(
        question,
        {
            "blanks": [
                r"\frac{ f^{(n+1)}(\xi) }{ (n+1)! } (x - x_{0})^{n+1}, 其中 \xi 介于 x 与 x_0 之间",
            ]
        },
        3,
    )

    assert score == 3
    assert correct is True
    assert feedback["dimensions"][0]["comment"] == "共命中 1/1 个空。"


@pytest.mark.asyncio
async def test_fill_in_grading_treats_same_multi_blank_answers_in_different_order_as_correct() -> None:
    question = _build_fill_in_question(
        {
            "correct": ["最小-最大标准化", "小数定标标准化", "Z-score标准化"],
        }
    )

    score, correct, feedback = await _grade_question_with_ai(
        question,
        {
            "blanks": ["最小-最大标准化", "Z-score标准化", "小数定标标准化"],
        },
        2,
    )

    assert score == 2
    assert correct is True
    assert feedback["dimensions"][0]["comment"] == "共命中 3/3 个空。"


@pytest.mark.asyncio
async def test_fill_in_grading_scores_partial_matches_without_requiring_blank_order(monkeypatch) -> None:
    async def fake_ai(*, expected_answers, student_answers, **_kwargs):
        assert expected_answers == ["A", "B", "C"]
        assert student_answers == ["C", "X", "A"]
        return [
            {"is_correct": False, "reason": "本地已命中的空不需要由 AI 覆盖。"},
            {"is_correct": False, "reason": "X 不能等价于 B。"},
            {"is_correct": False, "reason": "本地已命中的空不需要由 AI 覆盖。"},
        ]

    monkeypatch.setattr("app.exams.student_router._request_fill_in_equivalence_with_deepseek", fake_ai)
    question = _build_fill_in_question({"correct": ["A", "B", "C"]})

    score, correct, feedback = await _grade_question_with_ai(
        question,
        {"blanks": ["C", "X", "A"]},
        6,
    )

    assert score == 4
    assert correct is False
    assert feedback["dimensions"][0]["comment"] == "共命中 2/3 个空。"
    assert feedback["deductions"] == ["第 2 空应为 B"]


@pytest.mark.asyncio
async def test_fill_in_grading_skips_ai_when_student_did_not_answer(monkeypatch) -> None:
    async def fail_ai(**_kwargs):
        raise AssertionError("AI should not be called for an empty fill-in answer")

    monkeypatch.setattr("app.exams.student_router._request_fill_in_equivalence_with_deepseek", fail_ai)
    question = _build_fill_in_question({"correct": ["A", "B"]})

    score, correct, feedback = await _grade_question_with_ai(question, {"blanks": ["", ""]}, 4)

    assert score == 0
    assert correct is False
    assert feedback["dimensions"][0]["comment"] == "尚未作答。"


@pytest.mark.asyncio
async def test_fill_in_grading_reuses_cached_ai_result_when_answer_is_unchanged(monkeypatch) -> None:
    calls = 0

    async def fake_ai(*, expected_answers, student_answers, **_kwargs):
        nonlocal calls
        calls += 1
        assert expected_answers == ["A", "B"]
        assert student_answers == ["甲", "乙"]
        return [
            {"is_correct": True, "reason": "甲可等价于 A。"},
            {"is_correct": True, "reason": "乙可等价于 B。"},
        ]

    monkeypatch.setattr("app.exams.student_router._request_fill_in_equivalence_with_deepseek", fake_ai)
    question = _build_fill_in_question({"correct": ["A", "B"]})
    answer = {"blanks": ["甲", "乙"]}

    first_score, first_correct, _first_feedback = await _grade_question_with_ai(question, answer, 4)
    second_score, second_correct, second_feedback = await _grade_question_with_ai(question, answer, 4)

    assert calls == 1
    assert first_score == second_score == 4
    assert first_correct is True
    assert second_correct is True
    assert second_feedback["dimensions"][0]["comment"] == "共命中 2/2 个空。"
