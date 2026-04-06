"""Tests for grading rubric context builders."""

from app.grading.rubric_builders import build_code_rubric_context, build_short_answer_rubric_context


def test_build_code_rubric_context_includes_execution_evidence() -> None:
    task_payload = {
        "question_content": "实现 two sum",
        "student_answer_raw": "def two_sum(nums, target): return []",
        "rubric_definition": {"dimensions": [{"key": "correctness", "weight": 0.4}]},
        "test_summary": {"passed": 1, "total": 3},
        "compile_result": {"status": "passed"},
        "runtime_result": {"status": "failed"},
        "runtime_logs": ["assertion failed"],
    }

    context = build_code_rubric_context(task_payload)

    assert context == {
        "question_type": "code",
        "question": "实现 two sum",
        "max_score": None,
        "knowledge_tags": [],
        "student_answer": "def two_sum(nums, target): return []",
        "rubric_definition": {"dimensions": [{"key": "correctness", "weight": 0.4}]},
        "evidence": {
            "test_summary": {"passed": 1, "total": 3},
            "compile_result": {"status": "passed"},
            "runtime_result": {"status": "failed"},
            "runtime_logs": ["assertion failed"],
        },
    }


def test_build_code_rubric_context_defaults_missing_rubric_definition_to_empty_dict() -> None:
    task_payload = {
        "question_content": "实现 reverse list",
        "student_answer_raw": "def reverse_list(items): return items[::-1]",
        "rubric_definition": None,
    }

    context = build_code_rubric_context(task_payload)

    assert context["rubric_definition"] == {}
    assert context["evidence"] == {
        "test_summary": {},
        "compile_result": {},
        "runtime_result": {},
        "runtime_logs": [],
    }


def test_build_short_answer_rubric_context_includes_evidence_and_knowledge_points() -> None:
    task_payload = {
        "question_content": "什么是 TCP 三次握手",
        "student_answer_raw": "建立连接要先同步序列号",
        "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
        "scoring_points": [{"key": "sync_seq", "weight": 0.4}],
        "dimension_weights": {"coverage": 0.5, "accuracy": 0.5},
    }

    context = build_short_answer_rubric_context(task_payload)

    assert context == {
        "question_type": "short_answer",
        "question": "什么是 TCP 三次握手",
        "max_score": None,
        "knowledge_tags": [],
        "student_answer": "建立连接要先同步序列号",
        "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
        "evidence": {
            "knowledge_points": [{"key": "sync_seq", "weight": 0.4}],
            "dimension_weights": {"coverage": 0.5, "accuracy": 0.5},
        },
    }


def test_build_short_answer_rubric_context_defaults_missing_rubric_definition_to_empty_dict() -> None:
    task_payload = {
        "question_content": "简述 HTTP 状态码 200",
        "student_answer_raw": "表示请求成功",
        "rubric_definition": None,
    }

    context = build_short_answer_rubric_context(task_payload)

    assert context["rubric_definition"] == {}
    assert context["evidence"] == {"knowledge_points": [], "dimension_weights": {}}
