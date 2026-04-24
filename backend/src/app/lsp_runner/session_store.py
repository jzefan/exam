from app.lsp_runner.schemas import LspGatewaySession


class LspSessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, LspGatewaySession] = {}

    @staticmethod
    def build_session_key(session: LspGatewaySession) -> str:
        return f"{session.student_id}:{session.exam_id}:{session.question_id}:{session.language}"

    def open(self, session: LspGatewaySession) -> str:
        key = self.build_session_key(session)
        self._sessions[key] = session
        return key

    def close(self, session: LspGatewaySession) -> None:
        key = self.build_session_key(session)
        self._sessions.pop(key, None)

    def count(self) -> int:
        return len(self._sessions)
