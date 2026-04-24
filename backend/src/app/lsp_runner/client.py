import asyncio
from contextlib import suppress
from urllib.parse import urlencode, urlsplit, urlunsplit

from fastapi import WebSocket
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from app.lsp_runner.schemas import LspGatewaySession


def build_lsp_runner_ws_url(base_url: str, session: LspGatewaySession) -> str:
    parsed = urlsplit(base_url.rstrip("/"))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    query = urlencode(
        {
            "student_id": str(session.student_id),
            "exam_id": str(session.exam_id),
            "question_id": str(session.question_id),
            "language": session.language,
        }
    )
    path = f"{parsed.path.rstrip('/')}/ws/lsp" if parsed.path else "/ws/lsp"
    return urlunsplit((scheme, parsed.netloc, path, query, ""))


async def _relay_client_to_runner(websocket: WebSocket, upstream) -> None:
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            break
        text = message.get("text")
        if text is not None:
            await upstream.send(text)
            continue
        data = message.get("bytes")
        if data is not None:
            await upstream.send(data)


async def _relay_runner_to_client(websocket: WebSocket, upstream) -> None:
    async for message in upstream:
        if isinstance(message, bytes):
            await websocket.send_bytes(message)
        else:
            await websocket.send_text(message)


async def proxy_lsp_websocket(
    websocket: WebSocket,
    runner_url: str,
    session: LspGatewaySession,
) -> None:
    ws_url = build_lsp_runner_ws_url(runner_url, session)
    await websocket.accept()

    async with connect(ws_url, open_timeout=10, max_size=2_000_000) as upstream:
        client_task = asyncio.create_task(_relay_client_to_runner(websocket, upstream))
        runner_task = asyncio.create_task(_relay_runner_to_client(websocket, upstream))

        done, pending = await asyncio.wait(
            {client_task, runner_task},
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

        for task in done:
            exception = task.exception()
            if exception and not isinstance(exception, ConnectionClosed):
                raise exception
