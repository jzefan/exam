import uuid

from app.lsp_runner.client import build_lsp_runner_ws_url
from app.lsp_runner.schemas import LspGatewaySession


def test_build_lsp_runner_ws_url_converts_http_to_ws_and_appends_session_query() -> None:
    session = LspGatewaySession(
        student_id=uuid.uuid4(),
        exam_id=uuid.uuid4(),
        question_id=uuid.uuid4(),
        language="python",
    )

    url = build_lsp_runner_ws_url("http://judge-runner:8010", session)

    assert url.startswith("ws://judge-runner:8010/ws/lsp?")
    assert f"student_id={session.student_id}" in url
    assert f"exam_id={session.exam_id}" in url
    assert f"question_id={session.question_id}" in url
    assert "language=python" in url

