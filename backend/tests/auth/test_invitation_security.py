import uuid
from datetime import datetime, timedelta, timezone

from app.auth.invitation_security import (
    create_exam_take_token,
    decode_exam_take_token,
    generate_invitation_token,
    hash_invitation_token,
)


def test_generate_token_has_minimum_entropy():
    token = generate_invitation_token()
    assert len(token) >= 40
    assert token == token.strip()


def test_hash_is_deterministic_and_long():
    token = "abc123"
    assert hash_invitation_token(token) == hash_invitation_token(token)
    assert len(hash_invitation_token(token)) == 64


def test_exam_take_jwt_roundtrip():
    user_id = uuid.uuid4()
    exam_id = uuid.uuid4()
    expires = datetime.now(timezone.utc) + timedelta(hours=1)

    token = create_exam_take_token(user_id, exam_id, expires)
    payload = decode_exam_take_token(token)

    assert payload is not None
    assert payload["sub"] == str(user_id)
    assert payload["exam_id"] == str(exam_id)
    assert payload["scope"] == "exam_take"


def test_exam_take_jwt_expired():
    user_id = uuid.uuid4()
    exam_id = uuid.uuid4()
    expires = datetime.now(timezone.utc) - timedelta(seconds=1)

    token = create_exam_take_token(user_id, exam_id, expires)
    assert decode_exam_take_token(token) is None
