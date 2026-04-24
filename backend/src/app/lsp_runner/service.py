import asyncio
import shutil
import tempfile
from contextlib import suppress
from pathlib import Path

from app.lsp_runner.languages import build_language_server_command
from app.lsp_runner.schemas import LspGatewaySession, LspLanguage, LspSessionInfo
from app.lsp_runner.session_store import LspSessionStore


session_store = LspSessionStore()


def _prepare_java_workspace(workspace_path: Path) -> None:
    (workspace_path / "src").mkdir(parents=True, exist_ok=True)
    (workspace_path / ".project").write_text(
        """<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<projectDescription>
  <name>exam-java</name>
  <comment></comment>
  <projects></projects>
  <buildSpec>
    <buildCommand>
      <name>org.eclipse.jdt.core.javabuilder</name>
      <arguments></arguments>
    </buildCommand>
  </buildSpec>
  <natures>
    <nature>org.eclipse.jdt.core.javanature</nature>
  </natures>
</projectDescription>
""",
        encoding="utf-8",
    )
    (workspace_path / ".classpath").write_text(
        """<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<classpath>
  <classpathentry kind=\"src\" path=\"src\"/>
  <classpathentry kind=\"con\" path=\"org.eclipse.jdt.launching.JRE_CONTAINER/org.eclipse.jdt.internal.debug.ui.launcher.StandardVMType/JavaSE-21\"/>
  <classpathentry kind=\"output\" path=\"bin\"/>
</classpath>
""",
        encoding="utf-8",
    )


def _prepare_go_workspace(workspace_path: Path) -> None:
    (workspace_path / "go.mod").write_text(
        "module examlsp\n\ngo 1.25\n",
        encoding="utf-8",
    )


def _prepare_c_workspace(workspace_path: Path) -> None:
    (workspace_path / "compile_flags.txt").write_text(
        "-xc\n-std=c11\n-Wall\n",
        encoding="utf-8",
    )


def _prepare_cpp_workspace(workspace_path: Path) -> None:
    (workspace_path / "compile_flags.txt").write_text(
        "-xc++\n-std=c++17\n-Wall\n",
        encoding="utf-8",
    )


def prepare_lsp_workspace(language: LspLanguage, workspace_dir: str) -> None:
    workspace_path = Path(workspace_dir)
    workspace_path.mkdir(parents=True, exist_ok=True)
    if language == "java":
        _prepare_java_workspace(workspace_path)
    elif language == "go":
        _prepare_go_workspace(workspace_path)
    elif language == "c":
        _prepare_c_workspace(workspace_path)
    elif language == "cpp":
        _prepare_cpp_workspace(workspace_path)


async def open_lsp_session(session: LspGatewaySession) -> tuple[LspSessionInfo, asyncio.subprocess.Process]:
    session_key = session_store.open(session)
    workspace_dir = tempfile.mkdtemp(prefix=f"lsp-{session.language}-")
    prepare_lsp_workspace(session.language, workspace_dir)
    workspace_uri = Path(workspace_dir).resolve().as_uri()
    info = LspSessionInfo(
        session_key=session_key,
        language=session.language,
        command=build_language_server_command(session.language, workspace_dir),
        workspace_dir=workspace_dir,
        workspace_uri=workspace_uri,
    )
    process = await asyncio.create_subprocess_exec(
        *info.command,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=workspace_dir,
    )
    return info, process


def close_lsp_session(session: LspGatewaySession, workspace_dir: str | None = None) -> None:
    session_store.close(session)
    if workspace_dir:
        shutil.rmtree(workspace_dir, ignore_errors=True)


async def close_lsp_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return

    process.terminate()
    try:
        await asyncio.wait_for(process.wait(), timeout=3)
    except asyncio.TimeoutError:
        process.kill()
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(process.wait(), timeout=3)
