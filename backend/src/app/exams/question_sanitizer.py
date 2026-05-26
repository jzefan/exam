"""Strip answer-key fields from question content before serving to students."""

from copy import deepcopy

_CONTENT_BLOCKLIST = frozenset(
    {
        "correct_answer",
        "correct_options",
        "correct_option_ids",
        "explanation",
        "analysis",
        "solution",
        "reference_answer",
        "rubric",
        "hidden_test_cases",
    }
)

_OPTION_BLOCKLIST = frozenset({"is_correct", "explanation", "score_weight"})


def sanitize_question_content(content: dict) -> dict:
    result = deepcopy(content)
    for key in _CONTENT_BLOCKLIST:
        result.pop(key, None)
    return result


def sanitize_question_options(options: list | None) -> list:
    if not options:
        return []
    sanitized = []
    for option in options:
        if not isinstance(option, dict):
            sanitized.append(option)
            continue
        opt = deepcopy(option)
        for key in _OPTION_BLOCKLIST:
            opt.pop(key, None)
        sanitized.append(opt)
    return sanitized
