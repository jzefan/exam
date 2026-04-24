import uuid
from typing import Literal

from pydantic import BaseModel


LspLanguage = Literal["python", "javascript", "java", "c", "cpp", "go"]

SUPPORTED_LSP_LANGUAGES: tuple[LspLanguage, ...] = (
    "python",
    "javascript",
    "java",
    "c",
    "cpp",
    "go",
)


class LspGatewaySession(BaseModel):
    student_id: uuid.UUID
    exam_id: uuid.UUID
    question_id: uuid.UUID
    language: LspLanguage


class LspSessionInfo(BaseModel):
    session_key: str
    language: LspLanguage
    command: list[str]
    workspace_dir: str
    workspace_uri: str


class LspReadyEvent(BaseModel):
    type: Literal["ready"] = "ready"
    language: LspLanguage
    session_key: str
    capabilities: list[str]


class LspHealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    languages: list[LspLanguage]
    active_sessions: int
