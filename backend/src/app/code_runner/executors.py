"""Language command builders for the code runner."""

from dataclasses import dataclass
from shutil import which
import subprocess


@dataclass(frozen=True)
class LanguageSpec:
    source_filename: str
    compile_command: list[str] | None
    run_command: list[str]
    required_commands: tuple[str, ...]
    command_probes: dict[str, tuple[str, ...]]
    compile_timeout_seconds: int


def build_language_spec(language: str) -> LanguageSpec:
    normalized = language.lower()

    if normalized == "python":
        return LanguageSpec("main.py", None, ["python3", "main.py"], ("python3",), {"python3": ("--version",)}, 8)
    if normalized == "javascript":
        return LanguageSpec("main.js", None, ["node", "main.js"], ("node",), {"node": ("--version",)}, 8)
    if normalized == "java":
        return LanguageSpec(
            "Solution.java",
            ["javac", "Solution.java"],
            ["java", "Solution"],
            ("javac", "java"),
            {"javac": ("-version",), "java": ("-version",)},
            12,
        )
    if normalized == "c":
        return LanguageSpec(
            "main.c",
            ["gcc", "-O2", "main.c", "-o", "main"],
            ["./main"],
            ("gcc",),
            {"gcc": ("--version",)},
            8,
        )
    if normalized == "cpp":
        return LanguageSpec(
            "main.cpp",
            ["g++", "-O2", "-std=c++17", "main.cpp", "-o", "main"],
            ["./main"],
            ("g++",),
            {"g++": ("--version",)},
            8,
        )
    if normalized == "go":
        return LanguageSpec(
            "main.go",
            ["go", "build", "-o", "main", "main.go"],
            ["./main"],
            ("go",),
            {"go": ("version",)},
            20,
        )

    raise ValueError(f"Unsupported language: {language}")


def get_missing_commands(spec: LanguageSpec) -> tuple[str, ...]:
    missing_commands: list[str] = []
    for command in spec.required_commands:
        executable = which(command)
        if executable is None:
            missing_commands.append(command)
            continue

        # macOS may expose java/javac stubs even when no real runtime is installed.
        # Treat non-zero version probes as unavailable so the UI gets a clear message.
        try:
            completed = subprocess.run(
                [command, *spec.command_probes.get(command, ("--version",))],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            missing_commands.append(command)
            continue

        if completed.returncode != 0:
            missing_commands.append(command)

    return tuple(missing_commands)
