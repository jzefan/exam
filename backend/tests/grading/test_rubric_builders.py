"""Tests for grading rubric context builders."""

from app.grading.rubric_builders import build_code_rubric_context, build_short_answer_rubric_context


def test_build_code_rubric_context_includes_execution_evidence() -> None:
    task_payload = {
        "question_content": "实现 two sum",
        "student_answer_raw": "def two_sum(nums, target): return []",
        "standard_answers": [{"reference_code": "def two_sum(nums, target): return [0, 1]"}],
        "analysis": "可用哈希表记录补数。",
        "rubric_definition": {"dimensions": [{"key": "correctness", "weight": 0.4}]},
        "scoring_points": [{"key": "tests", "expected": "通过测试用例"}],
        "dimension_weights": {"correctness": 0.4},
        "deduction_rules": [{"condition": "compile_error", "deduct": "可执行性不得分"}],
        "fatal_error_rules": [{"condition": "blank_answer", "score": 0}],
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
        "standard_answers": [{"reference_code": "def two_sum(nums, target): return [0, 1]"}],
        "analysis": "可用哈希表记录补数。",
        "rubric_definition": {"dimensions": [{"key": "correctness", "weight": 0.4}]},
        "evidence": {
            "scoring_points": [{"key": "tests", "expected": "通过测试用例"}],
            "dimension_weights": {"correctness": 0.4},
            "deduction_rules": [{"condition": "compile_error", "deduct": "可执行性不得分"}],
            "fatal_error_rules": [{"condition": "blank_answer", "score": 0}],
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
    assert context["standard_answers"] == []
    assert context["evidence"] == {
        "scoring_points": [],
        "dimension_weights": {},
        "deduction_rules": [],
        "fatal_error_rules": [],
        "test_summary": {},
        "compile_result": {},
        "runtime_result": {},
        "runtime_logs": [],
    }


def test_build_short_answer_rubric_context_includes_evidence_and_knowledge_points() -> None:
    task_payload = {
        "question_content": "什么是 TCP 三次握手",
        "student_answer_raw": "建立连接要先同步序列号",
        "standard_answers": [{"points": ["SYN", "SYN-ACK", "ACK"]}],
        "analysis": "需要说明三次交互的目的。",
        "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
        "scoring_points": [{"key": "sync_seq", "weight": 0.4}],
        "dimension_weights": {"coverage": 0.5, "accuracy": 0.5},
        "deduction_rules": [{"condition": "missing_step", "deduct": "遗漏步骤扣分"}],
        "fatal_error_rules": [{"condition": "blank_answer", "score": 0}],
    }

    context = build_short_answer_rubric_context(task_payload)

    assert context == {
        "question_type": "short_answer",
        "question": "什么是 TCP 三次握手",
        "max_score": None,
        "knowledge_tags": [],
        "student_answer": "建立连接要先同步序列号",
        "standard_answers": [{"points": ["SYN", "SYN-ACK", "ACK"]}],
        "analysis": "需要说明三次交互的目的。",
        "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
        "evidence": {
            "knowledge_points": [{"key": "sync_seq", "weight": 0.4}],
            "dimension_weights": {"coverage": 0.5, "accuracy": 0.5},
            "deduction_rules": [{"condition": "missing_step", "deduct": "遗漏步骤扣分"}],
            "fatal_error_rules": [{"condition": "blank_answer", "score": 0}],
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
    assert context["standard_answers"] == []
    assert context["evidence"] == {
        "knowledge_points": [],
        "dimension_weights": {},
        "deduction_rules": [],
        "fatal_error_rules": [],
    }
