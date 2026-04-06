"""Workflow helpers for grading orchestration."""

from __future__ import annotations

from typing import Any


def should_trigger_arbitration(
    left: dict[str, Any],
    right: dict[str, Any],
    score_diff_threshold: float,
    dimension_diff_threshold: float,
) -> tuple[bool, str | None]:
    """Decide whether grading disagreement requires an arbitration pass."""

    max_score = max(left["score_total"], right["score_total"], 1)
    score_gap = abs(left["score_total"] - right["score_total"]) / max_score
    if score_gap > score_diff_threshold:
        return True, "score_diff"

    left_fatal = "fatal_error_candidate" in left.get("risk_flags", [])
    right_fatal = "fatal_error_candidate" in right.get("risk_flags", [])
    if left_fatal != right_fatal:
        return True, "fatal_conflict"

    left_dimensions = left.get("dimension_scores", {})
    right_dimensions = right.get("dimension_scores", {})
    for key, left_value in left_dimensions.items():
        right_value = right_dimensions.get(key, left_value)
        base = max(left_value, right_value, 1)
        if abs(left_value - right_value) / base > dimension_diff_threshold:
            return True, f"dimension_diff:{key}"

    return False, None
