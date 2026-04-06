"""Rubric context builders for grading orchestration."""


def build_code_rubric_context(task: dict) -> dict:
    return {
        "question_type": "code",
        "question": task["question_content"],
        "max_score": task.get("max_score"),
        "knowledge_tags": task.get("knowledge_tags") or [],
        "student_answer": task["student_answer_raw"],
        "rubric_definition": task.get("rubric_definition") or {},
        "evidence": {
            "test_summary": task.get("test_summary") or {},
            "compile_result": task.get("compile_result") or {},
            "runtime_result": task.get("runtime_result") or {},
            "runtime_logs": task.get("runtime_logs") or [],
        },
    }


def build_short_answer_rubric_context(task: dict) -> dict:
    return {
        "question_type": "short_answer",
        "question": task["question_content"],
        "max_score": task.get("max_score"),
        "knowledge_tags": task.get("knowledge_tags") or [],
        "student_answer": task["student_answer_raw"],
        "rubric_definition": task.get("rubric_definition") or {},
        "evidence": {
            "knowledge_points": task.get("scoring_points") or [],
            "dimension_weights": task.get("dimension_weights") or {},
        },
    }
