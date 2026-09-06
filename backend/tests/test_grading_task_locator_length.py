from app.exams.student_router import _build_grading_task_payload


class _Exam:
    def __init__(self) -> None:
        self.title = "测试考试"


class _Question:
    def __init__(
        self,
        *,
        question_type: str = "short_answer",
        content: dict | None = None,
        answer: dict | None = None,
        analysis: str | None = "解析内容",
    ) -> None:
        self.type = type("T", (), {"value": question_type})()
        self.content = content or {"text": "<p>题目内容</p>"}
        self.title = "题目"
        self.answer = answer or {"points": ["要点"]}
        self.analysis = analysis
        self.knowledge_points = []


def test_exam_submission_source_business_id_fits_column_budget() -> None:
    exam_id = "5eb21de2-2e08-41c6-bcfd-669959add676"
    question_id = "f292e7de-c517-4f8b-bc1e-612ceaca1925"
    student_id = "2fa0f755-1532-4ca9-9376-f3146e8d978b"
    source_business_id = f"{exam_id}:{question_id}:{student_id}"

    payload = _build_grading_task_payload(
        exam=_Exam(),
        question=_Question(),
        question_score=10,
        answer_content={"html": "<p>答案</p>"},
        role_binding_version=1,
        source_business_id=source_business_id,
    )

    assert payload["source_business_id"] == source_business_id
    assert len(source_business_id) == 110
    assert len(source_business_id) <= 160


def test_subjective_grading_payload_builds_short_answer_rubric_from_answer_points() -> None:
    payload = _build_grading_task_payload(
        exam=_Exam(),
        question=_Question(
            question_type="short_answer",
            answer={"points": ["说明核心概念", "给出应用场景"]},
            analysis="<p>参考解析：应覆盖定义和场景。</p>",
        ),
        question_score=10,
        answer_content={"html": "<p>学生作答</p>"},
        role_binding_version=1,
        source_business_id="exam:question:student:submission",
    )

    assert payload["standard_answers"] == [
        {
            "points": ["说明核心概念", "给出应用场景"],
            "analysis": "参考解析：应覆盖定义和场景。",
        }
    ]
    assert payload["rubric_definition"]["source"] == "system_default"
    assert [item["key"] for item in payload["rubric_definition"]["dimensions"]] == [
        "answer_point_coverage",
        "accuracy",
        "logic_completeness",
        "expression_quality",
    ]
    assert payload["dimension_weights"] == {
        "answer_point_coverage": 0.5,
        "accuracy": 0.3,
        "logic_completeness": 0.15,
        "expression_quality": 0.05,
    }
    assert [item["expected"] for item in payload["scoring_points"]] == ["说明核心概念", "给出应用场景"]


def test_subjective_grading_payload_builds_essay_rubric_with_stronger_structure_weight() -> None:
    payload = _build_grading_task_payload(
        exam=_Exam(),
        question=_Question(
            question_type="essay",
            answer={"points": ["观点明确", "论据充分"]},
        ),
        question_score=20,
        answer_content={"text": "学生论述"},
        role_binding_version=1,
        source_business_id="exam:question:student:submission",
    )

    assert payload["question_type"] == "essay"
    assert [item["key"] for item in payload["rubric_definition"]["dimensions"]] == [
        "answer_point_coverage",
        "argument_accuracy",
        "argument_depth",
        "structure_expression",
    ]
    assert payload["dimension_weights"] == {
        "answer_point_coverage": 0.35,
        "argument_accuracy": 0.25,
        "argument_depth": 0.25,
        "structure_expression": 0.15,
    }


def test_subjective_grading_payload_builds_code_rubric_from_execution_requirements() -> None:
    payload = _build_grading_task_payload(
        exam=_Exam(),
        question=_Question(
            question_type="code",
            content={
                "text": "实现两数之和。",
                "mode": "program",
                "input_description": "两个整数",
                "output_description": "两数之和",
                "sample_tests": [
                    {"input": "1 2", "expected_output": "3", "is_public": True},
                    {"input": "3 4", "expected_output": "7", "is_public": False},
                ],
            },
            answer={"code": "a, b = map(int, input().split())\nprint(a + b)"},
        ),
        question_score=20,
        answer_content={"language": "python", "code": "print(0)"},
        role_binding_version=1,
        source_business_id="exam:question:student:submission",
    )

    assert payload["standard_answers"] == [
        {
            "reference_code": "a, b = map(int, input().split())\nprint(a + b)",
            "analysis": "解析内容",
        }
    ]
    assert payload["student_answer_raw"] == "print(0)"
    assert payload["student_answer_structured"] == {"language": "python", "code": "print(0)"}
    assert payload["programming_language"] == "python"
    assert [item["key"] for item in payload["rubric_definition"]["dimensions"]] == [
        "test_correctness",
        "functional_completeness",
        "edge_cases",
        "code_quality",
    ]
    assert payload["dimension_weights"] == {
        "test_correctness": 0.55,
        "functional_completeness": 0.25,
        "edge_cases": 0.1,
        "code_quality": 0.1,
    }
    assert payload["scoring_points"][0]["expected"] == "通过公开与隐藏测试用例，输出与期望结果一致"
