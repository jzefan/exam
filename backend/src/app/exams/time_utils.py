from datetime import datetime, timezone
from zoneinfo import ZoneInfo

EXAM_DEFAULT_TIMEZONE = ZoneInfo("Asia/Shanghai")


def coerce_exam_input_datetime_to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=EXAM_DEFAULT_TIMEZONE).astimezone(timezone.utc)
    return value.astimezone(timezone.utc)


def coerce_exam_datetime_to_utc(value: datetime | None) -> datetime | None:
    """Backward-compatible alias for older imports.

    Some deployed revisions still import the pre-rename helper name.
    Keep this alias so mixed-version blue/green releases can boot safely.
    """
    return coerce_exam_input_datetime_to_utc(value)


def coerce_persisted_exam_datetime_to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
