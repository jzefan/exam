from app.exams.student_router import _grade_question
from app.questions.models import Question, QuestionType


def _build_code_question(*, mode: str, function_name: str | None = None) -> Question:
    content: dict[str, object] = {"mode": mode}
    if function_name:
        content["function_name"] = function_name
    return Question(
        type=QuestionType.CODE,
        title="代码题",
        content=content,
        options=None,
        answer={"required_patterns": ["return", "sum"]},
        analysis=None,
        difficulty=2,
        score=10,
        usage_count=0,
        created_by="170050d5-f106-4427-b05e-b0bd92857491",
        owner_id="170050d5-f106-4427-b05e-b0bd92857491",
    )


def test_program_mode_code_feedback_avoids_function_wording() -> None:
    question = _build_code_question(mode="program", function_name="twoSum")

    _, _, feedback = _grade_question(
        question,
        {"language": "python", "code": "print(total)"},
        10,
    )

    strengths = feedback["strengths"]
    suggestions = feedback["suggestions"]
    assert all("函数命名围绕" not in item for item in strengths)
    assert suggestions == ["继续补全边界处理、输入输出和示例测试。"]


def test_function_mode_code_feedback_keeps_function_wording() -> None:
    question = _build_code_question(mode="function", function_name="twoSum")

    _, _, feedback = _grade_question(
        question,
        {"language": "python", "code": "def twoSum(nums, target):\n    return sum(nums)"},
        10,
    )

    strengths = feedback["strengths"]
    assert any("函数命名围绕 twoSum 展开。" == item for item in strengths)
