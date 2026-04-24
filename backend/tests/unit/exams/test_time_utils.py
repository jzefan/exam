from datetime import datetime, timezone

from app.exams.time_utils import (
    coerce_exam_datetime_to_utc,
    coerce_exam_input_datetime_to_utc,
    coerce_persisted_exam_datetime_to_utc,
)


def test_coerce_exam_input_datetime_to_utc_treats_naive_values_as_shanghai_time() -> None:
    value = datetime(2026, 4, 23, 19, 10)

    result = coerce_exam_input_datetime_to_utc(value)

    assert result == datetime(2026, 4, 23, 11, 10, tzinfo=timezone.utc)


def test_coerce_exam_input_datetime_to_utc_preserves_aware_utc_equivalent() -> None:
    value = datetime.fromisoformat("2026-04-23T19:10:00+08:00")

    result = coerce_exam_input_datetime_to_utc(value)

    assert result == datetime(2026, 4, 23, 11, 10, tzinfo=timezone.utc)


def test_coerce_persisted_exam_datetime_to_utc_treats_naive_values_as_utc() -> None:
    value = datetime(2026, 4, 23, 11, 10)

    result = coerce_persisted_exam_datetime_to_utc(value)

    assert result == datetime(2026, 4, 23, 11, 10, tzinfo=timezone.utc)


def test_coerce_exam_datetime_to_utc_keeps_backward_compatible_behavior() -> None:
    value = datetime(2026, 4, 23, 19, 10)

    result = coerce_exam_datetime_to_utc(value)

    assert result == datetime(2026, 4, 23, 11, 10, tzinfo=timezone.utc)
