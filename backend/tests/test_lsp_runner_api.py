import uuid
import sys

from fastapi.testclient import TestClient
import pytest
from starlette.websockets import WebSocketDisconnect

from app.lsp_runner.main import app


def test_lsp_runner_health(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.lsp_runner.router.list_supported_lsp_languages",
        lambda: ["python", "javascript", "java", "c", "cpp", "go"],
    )
    client = TestClient(app)
    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert set(data["languages"]) == {"python", "javascript", "java", "c", "cpp", "go"}
    assert data["active_sessions"] == 0


@pytest.mark.asyncio
async def test_lsp_runner_websocket_proxies_jsonrpc_messages(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    student_id = uuid.uuid4()
    exam_id = uuid.uuid4()
    question_id = uuid.uuid4()

    script = (
        "import sys, json\n"
        "def read_message():\n"
        "    content_length=None\n"
        "    while True:\n"
        "        line=sys.stdin.buffer.readline()\n"
        "        if not line:\n"
        "            return None\n"
        "        if line==b'\\r\\n':\n"
        "            break\n"
        "        if line.lower().startswith(b'content-length:'):\n"
        "            content_length=int(line.split(b':',1)[1].strip())\n"
        "    if content_length is None:\n"
        "        return None\n"
        "    return json.loads(sys.stdin.buffer.read(content_length))\n"
        "msg=read_message()\n"
        "response={'jsonrpc':'2.0','id':msg.get('id'),'result':{'capabilities':{}}}\n"
        "payload=json.dumps(response).encode('utf-8')\n"
        "sys.stdout.buffer.write(f'Content-Length: {len(payload)}\\r\\n\\r\\n'.encode('ascii')+payload)\n"
        "sys.stdout.buffer.flush()\n"
    )
    monkeypatch.setattr(
        "app.lsp_runner.service.build_language_server_command",
        lambda language, workspace_dir: [sys.executable, "-u", "-c", script],
    )
    monkeypatch.setattr("app.lsp_runner.router.is_language_server_available", lambda language: True)

    with client.websocket_connect(
        f"/ws/lsp?student_id={student_id}&exam_id={exam_id}&question_id={question_id}&language=python"
    ) as websocket:
        websocket.send_json({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {},
        })
        message = websocket.receive_json()

    assert message == {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {"capabilities": {}},
    }


@pytest.mark.asyncio
async def test_lsp_runner_rewrites_initialize_and_document_uris(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(app)
    student_id = uuid.uuid4()
    exam_id = uuid.uuid4()
    question_id = uuid.uuid4()

    script = (
        "import sys, json\n"
        "def read_message():\n"
        "    content_length=None\n"
        "    while True:\n"
        "        line=sys.stdin.buffer.readline()\n"
        "        if not line:\n"
        "            return None\n"
        "        if line==b'\\r\\n':\n"
        "            break\n"
        "        if line.lower().startswith(b'content-length:'):\n"
        "            content_length=int(line.split(b':',1)[1].strip())\n"
        "    if content_length is None:\n"
        "        return None\n"
        "    return json.loads(sys.stdin.buffer.read(content_length))\n"
        "init_msg=read_message()\n"
        "response={'jsonrpc':'2.0','id':init_msg.get('id'),'result':{'capabilities':{}}}\n"
        "payload=json.dumps(response).encode('utf-8')\n"
        "sys.stdout.buffer.write(f'Content-Length: {len(payload)}\\r\\n\\r\\n'.encode('ascii')+payload)\n"
        "sys.stdout.buffer.flush()\n"
        "initialized_msg=read_message()\n"
        "did_open_msg=read_message()\n"
        "publish={'jsonrpc':'2.0','method':'textDocument/publishDiagnostics','params':{'uri':did_open_msg['params']['textDocument']['uri'],'diagnostics':[]}}\n"
        "payload=json.dumps(publish).encode('utf-8')\n"
        "sys.stdout.buffer.write(f'Content-Length: {len(payload)}\\r\\n\\r\\n'.encode('ascii')+payload)\n"
        "sys.stdout.buffer.flush()\n"
        "echo={'jsonrpc':'2.0','id':99,'result':{'rootUri':init_msg['params'].get('rootUri'),'workspaceFolders':init_msg['params'].get('workspaceFolders'),'didOpenUri':did_open_msg['params']['textDocument']['uri']}}\n"
        "payload=json.dumps(echo).encode('utf-8')\n"
        "sys.stdout.buffer.write(f'Content-Length: {len(payload)}\\r\\n\\r\\n'.encode('ascii')+payload)\n"
        "sys.stdout.buffer.flush()\n"
    )
    monkeypatch.setattr(
        "app.lsp_runner.service.build_language_server_command",
        lambda language, workspace_dir: [sys.executable, "-u", "-c", script],
    )
    monkeypatch.setattr("app.lsp_runner.router.is_language_server_available", lambda language: True)

    with client.websocket_connect(
        f"/ws/lsp?student_id={student_id}&exam_id={exam_id}&question_id={question_id}&language=java"
    ) as websocket:
        websocket.send_json({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {"rootUri": None},
        })
        init_response = websocket.receive_json()
        assert init_response == {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"capabilities": {}},
        }
        websocket.send_json({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {},
        })
        websocket.send_json({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": {
                    "uri": "file:///student-exam/question-1/Solution.java",
                    "languageId": "java",
                    "version": 1,
                    "text": "public class Solution {}",
                }
            },
        })
        diagnostics = websocket.receive_json()
        assert diagnostics == {
            "jsonrpc": "2.0",
            "method": "textDocument/publishDiagnostics",
            "params": {
                "uri": "file:///student-exam/question-1/Solution.java",
                "diagnostics": [],
            },
        }
        websocket.send_json({
            "jsonrpc": "2.0",
            "id": 99,
            "method": "textDocument/completion",
            "params": {
                "textDocument": {"uri": "file:///student-exam/question-1/Solution.java"},
                "position": {"line": 0, "character": 0},
            },
        })
        message = websocket.receive_json()

    workspace_uri = message["result"]["rootUri"]
    did_open_uri = message["result"]["didOpenUri"]
    assert workspace_uri.startswith("file:///")
    assert message["result"]["workspaceFolders"] == [{"uri": workspace_uri, "name": workspace_uri.rsplit("/", 1)[-1]}]
    assert did_open_uri.startswith(workspace_uri)
    assert did_open_uri.endswith("/src/Solution.java")


def test_lsp_runner_websocket_closes_when_language_server_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TestClient(app)
    student_id = uuid.uuid4()
    exam_id = uuid.uuid4()
    question_id = uuid.uuid4()

    monkeypatch.setattr("app.lsp_runner.router.is_language_server_available", lambda language: False)

    with client.websocket_connect(
        f"/ws/lsp?student_id={student_id}&exam_id={exam_id}&question_id={question_id}&language=java"
    ) as websocket:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            websocket.receive_text()

    assert exc_info.value.code == 1013
