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
    async def fake_ai(*, question_text, expected_answers, student_answers, knowledge_points=None):
        assert "Pandas" in question_text
        assert expected_answers == ["groupby", "agg", "transform"]
        assert student_answers == ["group by", "apply", "transform"]
        return [
            {"score": 1.0, "is_correct": True, "reason": "group by 与 groupby 表达同一 Pandas 方法。"},
            {"score": 0.0, "is_correct": False, "reason": "apply 不是标准答案中的 agg。"},
            {"score": 1.0, "is_correct": True, "reason": "完全一致。"},
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
    assert feedback["model_evaluation"]["model"] == "deepseek-v4-flash"
    assert feedback["model_evaluation"]["matches"][0]["reason"] == "group by 与 groupby 表达同一 Pandas 方法。"


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
async def test_fill_in_grading_treats_empty_function_calls_as_function_names(monkeypatch) -> None:
    async def fail_ai(**_kwargs):
        raise AssertionError("local normalization should match empty function calls")

    monkeypatch.setattr("app.exams.student_router._request_fill_in_equivalence_with_deepseek", fail_ai)
    question = _build_fill_in_question({"correct": ["groupby", "agg", "transform"]})

    score, correct, feedback = await _grade_question_with_ai(
        question,
        {"blanks": ["agg()", "apply()", "transform()"]},
        2,
    )

    assert score == 1.33
    assert correct is False
    assert feedback["dimensions"][0]["comment"] == "共命中 2/3 个空。"
    assert feedback["deductions"] == ["第 1 空应为 groupby"]


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
            {"score": 1.0, "is_correct": True, "reason": "甲可等价于 A。"},
            {"score": 1.0, "is_correct": True, "reason": "乙可等价于 B。"},
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


@pytest.mark.asyncio
async def test_fill_in_grading_does_not_cache_when_ai_call_fails(monkeypatch) -> None:
    """A failed DeepSeek call should NOT poison the cache with a low score.

    Otherwise a transient outage permanently locks the student at 0 until a
    manual force-recompute is triggered.
    """
    call_count = 0

    async def flaky_ai(*, question_text, expected_answers, student_answers, knowledge_points=None):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise RuntimeError("DeepSeek rate-limited")
        return [{"score": 1.0, "is_correct": True, "reason": "equivalent"}]

    monkeypatch.setattr(
        "app.exams.student_router._request_fill_in_equivalence_with_deepseek", flaky_ai
    )
    question = _build_fill_in_question({"correct": ["xlabel"]})
    answer = {"blanks": ["plt.xlabel()"]}

    first_score, first_correct, first_feedback = await _grade_question_with_ai(question, answer, 2)
    assert first_score == 0
    assert first_correct is False
    assert "grading_warning" in first_feedback
    assert "_fill_in_grading_cache" not in answer  # NOT cached

    # Second call retries the LLM rather than returning the cached 0.
    second_score, second_correct, _ = await _grade_question_with_ai(question, answer, 2)
    assert call_count == 2
    assert second_score == 2
    assert second_correct is True


@pytest.mark.asyncio
async def test_fill_in_grading_force_recompute_bypasses_cache(monkeypatch) -> None:
    """force_recompute=True must re-run the AI matcher, ignoring prior cache."""
    call_count = 0

    async def counting_ai(*, question_text, expected_answers, student_answers, knowledge_points=None):
        nonlocal call_count
        call_count += 1
        # First call returns wrong verdict, second returns right verdict (simulates
        # what happens when the standard answer or model behavior changes between
        # submission time and a teacher-initiated regrade).
        verdict_score = 1.0 if call_count > 1 else 0.0
        return [{"score": verdict_score, "is_correct": verdict_score >= 1.0, "reason": "v" + str(call_count)}]

    monkeypatch.setattr(
        "app.exams.student_router._request_fill_in_equivalence_with_deepseek", counting_ai
    )
    question = _build_fill_in_question({"correct": ["xlabel"]})
    answer = {"blanks": ["plt.xlabel()"]}

    initial_score, _, _ = await _grade_question_with_ai(question, answer, 2)
    assert initial_score == 0
    assert call_count == 1

    # Same inputs, no force_recompute → cache hit, no new AI call.
    cached_score, _, _ = await _grade_question_with_ai(question, answer, 2)
    assert call_count == 1
    assert cached_score == 0

    # force_recompute → bypass cache, hit AI again, return new verdict.
    fresh_score, fresh_correct, _ = await _grade_question_with_ai(
        question, answer, 2, force_recompute=True
    )
    assert call_count == 2
    assert fresh_score == 2
    assert fresh_correct is True


@pytest.mark.asyncio
async def test_fill_in_grading_awards_partial_credit_when_ai_returns_half(monkeypatch) -> None:
    """When DeepSeek returns score=0.5 for a knowledge-point-aligned answer,
    the student gets half credit (not full and not zero)."""

    async def fake_ai(*, question_text, expected_answers, student_answers, knowledge_points=None):
        # First blank: full credit (semantically equivalent).
        # Second blank: partial credit (matches knowledge point but text differs).
        # Third blank: no credit.
        return [
            {"score": 1.0, "is_correct": True, "reason": "exact"},
            {"score": 0.5, "is_correct": False, "reason": "concept match, wording off"},
            {"score": 0.0, "is_correct": False, "reason": "no match"},
        ]

    monkeypatch.setattr(
        "app.exams.student_router._request_fill_in_equivalence_with_deepseek", fake_ai
    )
    question = _build_fill_in_question({"correct": ["A1", "A2", "A3"]})

    score, correct, feedback = await _grade_question_with_ai(
        question,
        {"blanks": ["alt1", "alt2", "wrong"]},
        9,
    )

    # Per-blank max = 9/3 = 3. Total credit = 1.0 + 0.5 + 0.0 = 1.5 → 1.5 * 3 = 4.5.
    assert score == 4.5
    assert correct is False
    assert "另有 1 个空获得部分分" in feedback["dimensions"][0]["comment"]
    # Partial-credit blank is NOT in deductions (only blanks scoring exactly 0 are).
    assert feedback["deductions"] == ["第 3 空应为 A3"]
    assert any("第 2 空部分得分" in s for s in feedback["strengths"])
    assert feedback["model_evaluation"]["matches"][1]["score"] == 0.5


@pytest.mark.asyncio
async def test_fill_in_grading_passes_knowledge_points_to_ai(monkeypatch) -> None:
    """KP names from the question are forwarded to DeepSeek for the
    knowledge-point-correction rule."""
    from app.learning.models import KnowledgePoint

    captured: dict[str, object] = {}

    async def fake_ai(*, question_text, expected_answers, student_answers, knowledge_points=None):
        captured["knowledge_points"] = knowledge_points
        return [{"score": 1.0, "is_correct": True, "reason": "ok"}]

    monkeypatch.setattr(
        "app.exams.student_router._request_fill_in_equivalence_with_deepseek", fake_ai
    )

    question = _build_fill_in_question({"correct": ["xlabel"]})
    question.knowledge_points = [
        KnowledgePoint(name="Matplotlib 绘图"),
        KnowledgePoint(name="图表注释"),
    ]

    await _grade_question_with_ai(question, {"blanks": ["set_xlabel"]}, 2)
    assert captured["knowledge_points"] == ["Matplotlib 绘图", "图表注释"]
