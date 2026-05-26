"""Tests for the question sanitizer that strips answer-key fields."""

import pytest

from app.exams.question_sanitizer import sanitize_question_content, sanitize_question_options


def test_sanitize_content_removes_blocklisted_keys() -> None:
    content = {
        "text": "<p>What is X?</p>",
        "correct_answer": "42",
        "correct_options": ["A"],
        "correct_option_ids": [1, 2],
        "explanation": "Because math",
        "analysis": "Deep analysis",
        "solution": "x = 42",
        "reference_answer": "see above",
        "rubric": "award 3pts for ...",
        "hidden_test_cases": [{"input": "1", "output": "1"}],
        "sample_tests": [{"input": "0", "output": "0"}],
    }
    result = sanitize_question_content(content)
    for key in (
        "correct_answer", "correct_options", "correct_option_ids",
        "explanation", "analysis", "solution", "reference_answer",
        "rubric", "hidden_test_cases",
    ):
        assert key not in result, f"expected {key} to be stripped"
    assert result["text"] == content["text"]
    assert result["sample_tests"] == content["sample_tests"]


def test_sanitize_content_does_not_mutate_input() -> None:
    content = {"text": "q", "correct_answer": "a"}
    sanitize_question_content(content)
    assert "correct_answer" in content


def test_sanitize_content_empty() -> None:
    assert sanitize_question_content({}) == {}


def test_sanitize_options_removes_blocklisted_keys() -> None:
    options = [
        {"id": "A", "text": "Yes", "is_correct": True, "explanation": "Correct!", "score_weight": 1.0},
        {"id": "B", "text": "No", "is_correct": False},
    ]
    result = sanitize_question_options(options)
    for opt in result:
        assert "is_correct" not in opt
        assert "explanation" not in opt
        assert "score_weight" not in opt
    assert result[0]["id"] == "A"
    assert result[0]["text"] == "Yes"
    assert result[1]["id"] == "B"


def test_sanitize_options_does_not_mutate_input() -> None:
    options = [{"id": "A", "is_correct": True}]
    sanitize_question_options(options)
    assert "is_correct" in options[0]


def test_sanitize_options_non_dict_items_pass_through() -> None:
    options = ["A", "B", None]
    result = sanitize_question_options(options)
    assert result == options


def test_sanitize_options_empty() -> None:
    assert sanitize_question_options([]) == []
