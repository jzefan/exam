from pathlib import Path
import shutil

from app.lsp_runner.schemas import LspLanguage, SUPPORTED_LSP_LANGUAGES


def build_language_server_command(language: LspLanguage, workspace_dir: str) -> list[str]:
    if language == "python":
        return ["pyright-langserver", "--stdio"]
    if language == "javascript":
        return ["typescript-language-server", "--stdio"]
    if language == "java":
        return ["/usr/local/bin/jdtls-wrapper", workspace_dir]
    if language in {"c", "cpp"}:
        return ["clangd", "--background-index=false"]
    if language == "go":
        return ["gopls"]
    raise ValueError(f"Unsupported LSP language: {language}")


def is_language_server_available(language: LspLanguage) -> bool:
    command = build_language_server_command(language, "/tmp/lsp-workspace")
    executable = command[0]
    return Path(executable).exists() if executable.startswith("/") else shutil.which(executable) is not None


def list_supported_lsp_languages() -> list[LspLanguage]:
    return [language for language in SUPPORTED_LSP_LANGUAGES if is_language_server_available(language)]

