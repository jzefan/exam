"""Utilities for detecting duplicate or near-duplicate questions."""

from __future__ import annotations

import re
from typing import Any


_SIMILARITY_THRESHOLD = 0.52
_MIN_CONTAINMENT_LENGTH = 18


def _field(source: Any, name: str) -> Any:
    if isinstance(source, dict):
        return source.get(name)
    return getattr(source, name, None)


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        preferred = value.get("text") or value.get("html") or value.get("markdown")
        if preferred is not None:
            return _stringify(preferred)
        return " ".join(_stringify(item) for item in value.values())
    if isinstance(value, (list, tuple, set)):
        return " ".join(_stringify(item) for item in value)
    return str(value)


def question_similarity_text(question: Any) -> str:
    """Build the text surface used to compare two questions for near-duplicates."""
    title = _stringify(_field(question, "title"))
    content = _stringify(_field(question, "content"))
    options = _stringify(_field(question, "options"))
    return " ".join(part for part in (title, content, options) if part).strip()


def normalize_question_similarity_text(value: Any) -> str:
    text = question_similarity_text(value) if not isinstance(value, str) else value
    text = text.lower()
    return "".join(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]+", text))


def _char_bigrams(text: str) -> set[str]:
    if len(text) <= 1:
        return {text} if text else set()
    return {text[index : index + 2] for index in range(len(text) - 1)}


def question_similarity_score(left: Any, right: Any) -> float:
    left_text = normalize_question_similarity_text(left)
    right_text = normalize_question_similarity_text(right)
    if not left_text or not right_text:
        return 0.0
    if left_text == right_text:
        return 1.0

    shorter, longer = sorted((left_text, right_text), key=len)
    if (
        len(shorter) >= _MIN_CONTAINMENT_LENGTH
        and shorter in longer
        and len(shorter) / max(1, len(longer)) >= 0.58
    ):
        return 1.0

    left_bigrams = _char_bigrams(left_text)
    right_bigrams = _char_bigrams(right_text)
    if not left_bigrams or not right_bigrams:
        return 0.0
    overlap = len(left_bigrams & right_bigrams)
    return (2 * overlap) / (len(left_bigrams) + len(right_bigrams))


def questions_are_too_similar(left: Any, right: Any, *, threshold: float = _SIMILARITY_THRESHOLD) -> bool:
    return question_similarity_score(left, right) >= threshold


def question_is_too_similar_to_any(
    candidate: Any,
    existing_questions: list[Any],
    *,
    threshold: float = _SIMILARITY_THRESHOLD,
) -> bool:
    return any(questions_are_too_similar(candidate, existing, threshold=threshold) for existing in existing_questions)


def question_summary_for_prompt(question: Any, *, max_length: int = 140) -> str:
    text = re.sub(r"\s+", " ", question_similarity_text(question)).strip()
    if len(text) > max_length:
        return f"{text[:max_length]}..."
    return text
