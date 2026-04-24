import uuid
import asyncio
import json
from contextlib import suppress
from pathlib import Path
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, Query, WebSocket

from app.lsp_runner.languages import is_language_server_available, list_supported_lsp_languages
from app.lsp_runner.schemas import (
    LspGatewaySession,
    LspHealthResponse,
    LspLanguage,
    LspSessionInfo,
)
from app.lsp_runner.service import close_lsp_process, close_lsp_session, open_lsp_session, session_store

router = APIRouter()

LANGUAGE_FILE_EXTENSIONS: dict[LspLanguage, str] = {
    "python": "py",
    "javascript": "js",
    "java": "java",
    "cpp": "cpp",
    "c": "c",
    "go": "go",
}


def _basename_from_uri(uri: str | None, language: LspLanguage) -> str:
    parsed = urlparse(uri or "")
    basename = Path(unquote(parsed.path)).name if parsed.path else ""
    if basename:
        return basename
    return f"solution.{LANGUAGE_FILE_EXTENSIONS[language]}"


def _resolve_server_uri(
    uri_map: dict[str, str],
    *,
    workspace_dir: str,
    language: LspLanguage,
    client_uri: str,
) -> str:
    existing = uri_map.get(client_uri)
    if existing:
        return existing

    basename = _basename_from_uri(client_uri, language)
    relative_dir = Path("src") if language == "java" else Path(".")
    server_path = Path(workspace_dir, relative_dir, basename).resolve()
    server_path.parent.mkdir(parents=True, exist_ok=True)
    server_uri = server_path.as_uri()
    uri_map[client_uri] = server_uri
    return server_uri


def _rewrite_client_message(
    message: dict[str, object],
    *,
    info: LspSessionInfo,
    uri_map: dict[str, str],
) -> tuple[dict[str, object], list[tuple[Path, str]]]:
    rewritten = json.loads(json.dumps(message))
    writes: list[tuple[Path, str]] = []
    method = rewritten.get("method")
    params = rewritten.get("params")

    if method == "initialize" and isinstance(params, dict):
        params["rootUri"] = info.workspace_uri
        params["rootPath"] = info.workspace_dir
        params["workspaceFolders"] = [
            {
                "uri": info.workspace_uri,
                "name": Path(info.workspace_dir).name,
            }
        ]
        return rewritten, writes

    if not isinstance(params, dict):
        return rewritten, writes

    text_document = params.get("textDocument")
    if isinstance(text_document, dict):
        client_uri = text_document.get("uri")
        if isinstance(client_uri, str):
            server_uri = _resolve_server_uri(
                uri_map,
                workspace_dir=info.workspace_dir,
                language=info.language,
                client_uri=client_uri,
            )
            text_document["uri"] = server_uri
            if method in {"textDocument/didOpen", "textDocument/didChange"}:
                server_path = Path(urlparse(server_uri).path)
                if method == "textDocument/didOpen":
                    text = text_document.get("text")
                    if isinstance(text, str):
                        writes.append((server_path, text))
                else:
                    content_changes = params.get("contentChanges")
                    if isinstance(content_changes, list) and content_changes:
                        latest = content_changes[-1]
                        if isinstance(latest, dict):
                            text = latest.get("text")
                            if isinstance(text, str):
                                writes.append((server_path, text))

    return rewritten, writes


def _rewrite_server_message(message: dict[str, object], uri_map: dict[str, str]) -> dict[str, object]:
    rewritten = json.loads(json.dumps(message))
    params = rewritten.get("params")
    reverse_map = {server_uri: client_uri for client_uri, server_uri in uri_map.items()}

    if rewritten.get("method") == "textDocument/publishDiagnostics" and isinstance(params, dict):
        uri = params.get("uri")
        if isinstance(uri, str) and uri in reverse_map:
            params["uri"] = reverse_map[uri]

    return rewritten


async def _write_lsp_message(
    stream: asyncio.StreamWriter | None,
    payload: str,
) -> None:
    if stream is None:
        raise RuntimeError("Language server stdin unavailable")

    body = payload.encode("utf-8")
    stream.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body)
    await stream.drain()


async def _read_lsp_message(stream: asyncio.StreamReader | None) -> str:
    if stream is None:
        raise RuntimeError("Language server stdout unavailable")

    content_length: int | None = None
    while True:
        line = await stream.readline()
        if not line:
            raise EOFError("Language server closed stdout")
        if line == b"\r\n":
            break

        header = line.decode("ascii", errors="ignore").strip()
        if header.lower().startswith("content-length:"):
            content_length = int(header.split(":", 1)[1].strip())

    if content_length is None:
        raise RuntimeError("Missing Content-Length header from language server")

    body = await stream.readexactly(content_length)
    return body.decode("utf-8")


async def _drain_process_stderr(process: asyncio.subprocess.Process) -> None:
    if process.stderr is None:
        return
    while True:
        chunk = await process.stderr.read(1024)
        if not chunk:
            return


async def _relay_client_to_server(
    websocket: WebSocket,
    process: asyncio.subprocess.Process,
    *,
    info: LspSessionInfo,
    uri_map: dict[str, str],
) -> None:
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return
        text = message.get("text")
        if text is not None:
            payload = json.loads(text)
            rewritten, writes = _rewrite_client_message(payload, info=info, uri_map=uri_map)
            for path, content in writes:
                path.write_text(content, encoding="utf-8")
            await _write_lsp_message(process.stdin, json.dumps(rewritten))
            continue
        data = message.get("bytes")
        if data is not None:
            payload = json.loads(data.decode("utf-8"))
            rewritten, writes = _rewrite_client_message(payload, info=info, uri_map=uri_map)
            for path, content in writes:
                path.write_text(content, encoding="utf-8")
            await _write_lsp_message(process.stdin, json.dumps(rewritten))


async def _relay_server_to_client(
    websocket: WebSocket,
    process: asyncio.subprocess.Process,
    *,
    uri_map: dict[str, str],
) -> None:
    while True:
        message = json.loads(await _read_lsp_message(process.stdout))
        rewritten = _rewrite_server_message(message, uri_map)
        await websocket.send_text(json.dumps(rewritten))


@router.get("/health", response_model=LspHealthResponse)
async def health() -> LspHealthResponse:
    return LspHealthResponse(
        languages=list_supported_lsp_languages(),
        active_sessions=session_store.count(),
    )


@router.websocket("/ws/lsp")
async def lsp_socket(
    websocket: WebSocket,
    student_id: uuid.UUID,
    exam_id: uuid.UUID,
    question_id: uuid.UUID,
    language: LspLanguage = Query(...),
) -> None:
    session = LspGatewaySession(
        student_id=student_id,
        exam_id=exam_id,
        question_id=question_id,
        language=language,
    )
    if not is_language_server_available(language):
        await websocket.accept()
        await websocket.close(code=1013, reason=f"{language} language service unavailable")
        return

    info, process = await open_lsp_session(session)
    await websocket.accept()
    uri_map: dict[str, str] = {}
    stderr_task = asyncio.create_task(_drain_process_stderr(process))
    client_task = asyncio.create_task(_relay_client_to_server(websocket, process, info=info, uri_map=uri_map))
    server_task = asyncio.create_task(_relay_server_to_client(websocket, process, uri_map=uri_map))
    try:
        done, pending = await asyncio.wait(
            {client_task, server_task, stderr_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in done:
            exception = task.exception()
            if exception and not isinstance(exception, EOFError):
                raise exception
        for task in pending:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
    finally:
        await close_lsp_process(process)
        close_lsp_session(session, info.workspace_dir)
