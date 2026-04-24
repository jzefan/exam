from pathlib import Path

from app.lsp_runner.service import prepare_lsp_workspace


def test_prepare_lsp_workspace_writes_java_project_files(tmp_path: Path) -> None:
    prepare_lsp_workspace("java", str(tmp_path))

    assert (tmp_path / "src").is_dir()
    assert (tmp_path / ".project").exists()
    assert (tmp_path / ".classpath").exists()


def test_prepare_lsp_workspace_writes_c_compile_flags(tmp_path: Path) -> None:
    prepare_lsp_workspace("c", str(tmp_path))

    assert (tmp_path / "compile_flags.txt").read_text(encoding="utf-8") == "-xc\n-std=c11\n-Wall\n"


def test_prepare_lsp_workspace_writes_cpp_compile_flags(tmp_path: Path) -> None:
    prepare_lsp_workspace("cpp", str(tmp_path))

    assert (tmp_path / "compile_flags.txt").read_text(encoding="utf-8") == "-xc++\n-std=c++17\n-Wall\n"


def test_prepare_lsp_workspace_writes_go_module(tmp_path: Path) -> None:
    prepare_lsp_workspace("go", str(tmp_path))

    assert (tmp_path / "go.mod").read_text(encoding="utf-8") == "module examlsp\n\ngo 1.25\n"
