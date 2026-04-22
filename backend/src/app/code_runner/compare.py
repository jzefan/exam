"""Helpers for comparing code runner output."""


def normalize_output(value: str | None) -> str:
    """Normalize code runner output for comparison."""
    if value is None:
        return ""
    lines = value.replace("\r\n", "\n").splitlines()
    return "\n".join(line.rstrip() for line in lines)


def compare_case_output(actual: str | None, expected: str | None) -> bool:
    if expected is None:
        return False
    return normalize_output(actual) == normalize_output(expected)
