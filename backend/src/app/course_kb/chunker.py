"""Heading-aware material chunker (pure functions), ported from ArkLoop bookchunker.

Strategy (mirrors the ArkLoop design):
1. Split on heading boundaries first (chapters/sections never merge together).
2. Pack paragraphs into chunks of [MIN_TOKENS, MAX_TOKENS] (defaults 256/512).
3. Keep ~OVERLAP_TOKENS of trailing context between adjacent text chunks.
4. Code / formula / table blocks always become standalone chunks.
5. Every chunk carries its heading_path (e.g. ["第三章 程序流程控制", "3.2 循环结构"]).

Token counts are estimated (CJK chars ≈ 1 token each, latin words ≈ 1.3 tokens)
— exact enough for packing; same inputs always produce the same outputs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

MIN_TOKENS = 256
MAX_TOKENS = 512
OVERLAP_TOKENS = 40

_CJK_RE = re.compile(r"[一-鿿　-〿＀-￯]")
_LATIN_WORD_RE = re.compile(r"[A-Za-z0-9_]+")

# Chinese textbook / markdown heading shapes.
_HEADING_RES: tuple[tuple[int, re.Pattern[str]], ...] = (
    (1, re.compile(r"^(第\s*[0-9一二三四五六七八九十百]+\s*[章篇部])\s*\S{0,40}$")),
    (2, re.compile(r"^(第\s*[0-9一二三四五六七八九十百]+\s*[节讲课])\s*\S{0,40}$")),
    (2, re.compile(r"^\d{1,2}\.\d{1,2}(\.\d{1,2})?\s+\S{1,40}$")),
    (1, re.compile(r"^#\s+\S")),
    (2, re.compile(r"^#{2,4}\s+\S")),
)

_CODE_HINT_RE = re.compile(
    r"^(def |class |import |from |for |while |if |print\(|return |function |var |let |const |#include|public |private )"
)
_FORMULA_HINT_RE = re.compile(r"(\$\$|\\frac|\\sum|\\int|\\sqrt|[∑∫√≤≥≠±×÷]|[a-zA-Z]\s*=\s*[^=])")
_TABLE_HINT_RE = re.compile(r"^\s*(\[TABLE|\|.+\|)\s*")


@dataclass(frozen=True, slots=True)
class MaterialChunk:
    ordinal: int
    heading_path: tuple[str, ...]
    chunk_type: str  # text | code | formula | table
    text: str
    token_count: int


@dataclass
class _Block:
    kind: str  # heading | paragraph | code | table
    level: int = 0
    lines: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n".join(self.lines).strip()


def estimate_tokens(text: str) -> int:
    cjk = len(_CJK_RE.findall(text))
    latin_words = len(_LATIN_WORD_RE.findall(text))
    return cjk + int(latin_words * 1.3)


def _heading_level(line: str) -> int | None:
    stripped = line.strip()
    if not stripped or len(stripped) > 60:
        return None
    for level, pattern in _HEADING_RES:
        if pattern.match(stripped):
            return level
    return None


def _looks_like_code_block(lines: list[str]) -> bool:
    if not lines:
        return False
    hits = sum(1 for line in lines if _CODE_HINT_RE.match(line.strip()) or line.startswith(("    ", "\t")))
    return hits >= max(2, len(lines) // 2)


def _split_blocks(text: str) -> list[_Block]:
    """Lex the raw material text into heading / table / code / paragraph blocks."""
    blocks: list[_Block] = []
    paragraph: list[str] = []
    in_code_fence = False
    code_lines: list[str] = []

    def flush_paragraph() -> None:
        nonlocal paragraph
        joined = [line for line in paragraph if line.strip()]
        if joined:
            kind = "code" if _looks_like_code_block(joined) else "paragraph"
            blocks.append(_Block(kind=kind, lines=joined))
        paragraph = []

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if line.strip().startswith("```"):
            if in_code_fence:
                blocks.append(_Block(kind="code", lines=code_lines))
                code_lines = []
                in_code_fence = False
            else:
                flush_paragraph()
                in_code_fence = True
            continue
        if in_code_fence:
            code_lines.append(raw_line)
            continue

        level = _heading_level(line)
        if level is not None:
            flush_paragraph()
            blocks.append(_Block(kind="heading", level=level, lines=[line.strip().lstrip("#").strip()]))
            continue
        if _TABLE_HINT_RE.match(line):
            flush_paragraph()
            blocks.append(_Block(kind="table", lines=[line]))
            continue
        if not line.strip():
            flush_paragraph()
            continue
        paragraph.append(line)

    if in_code_fence and code_lines:
        blocks.append(_Block(kind="code", lines=code_lines))
    flush_paragraph()
    return blocks


def _classify_text(text: str) -> str:
    formula_hits = len(_FORMULA_HINT_RE.findall(text))
    if formula_hits >= 3 and formula_hits * 24 > len(text):
        return "formula"
    return "text"


def _tail_overlap(text: str, overlap_tokens: int) -> str:
    """Last ~overlap_tokens worth of text, cut on a sentence boundary if possible."""
    if overlap_tokens <= 0:
        return ""
    approx_chars = overlap_tokens * 2
    tail = text[-approx_chars:]
    for sep in ("。", "！", "？", ".\n", "\n"):
        idx = tail.find(sep)
        if 0 <= idx < len(tail) - 1:
            return tail[idx + len(sep) :].strip()
    return tail.strip()


def chunk_material(
    text: str,
    *,
    min_tokens: int = MIN_TOKENS,
    max_tokens: int = MAX_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> list[MaterialChunk]:
    """Chunk raw material text into typed, heading-scoped retrieval units."""
    blocks = _split_blocks(text or "")
    chunks: list[MaterialChunk] = []
    heading_path: list[str] = []
    buffer: list[str] = []
    buffer_tokens = 0
    ordinal = 0

    def emit(chunk_text: str, chunk_type: str) -> None:
        nonlocal ordinal
        cleaned = chunk_text.strip()
        if not cleaned:
            return
        chunks.append(
            MaterialChunk(
                ordinal=ordinal,
                heading_path=tuple(heading_path),
                chunk_type=chunk_type,
                text=cleaned,
                token_count=estimate_tokens(cleaned),
            )
        )
        ordinal += 1

    def flush_buffer(*, carry_overlap: bool) -> None:
        nonlocal buffer, buffer_tokens
        if not buffer:
            return
        joined = "\n".join(buffer)
        emit(joined, _classify_text(joined))
        overlap = _tail_overlap(joined, overlap_tokens) if carry_overlap else ""
        buffer = [overlap] if overlap else []
        buffer_tokens = estimate_tokens(overlap) if overlap else 0

    for block in blocks:
        if block.kind == "heading":
            flush_buffer(carry_overlap=False)
            # A level-1 heading resets the path; level-2 nests under the chapter.
            if block.level <= 1:
                heading_path = [block.text]
            else:
                heading_path = [*heading_path[:1], block.text]
            continue
        if block.kind in ("code", "table"):
            flush_buffer(carry_overlap=False)
            emit(block.text, block.kind)
            continue

        paragraph_tokens = estimate_tokens(block.text)
        if buffer_tokens + paragraph_tokens > max_tokens and buffer_tokens >= min_tokens:
            flush_buffer(carry_overlap=True)
        if paragraph_tokens > max_tokens:
            # Oversized single paragraph: hard-split on sentence boundaries.
            flush_buffer(carry_overlap=False)
            sentences = re.split(r"(?<=[。！？.!?])", block.text)
            for sentence in sentences:
                sentence_tokens = estimate_tokens(sentence)
                if buffer_tokens + sentence_tokens > max_tokens and buffer:
                    flush_buffer(carry_overlap=True)
                if sentence.strip():
                    buffer.append(sentence.strip())
                    buffer_tokens += sentence_tokens
            continue
        buffer.append(block.text)
        buffer_tokens += paragraph_tokens

    flush_buffer(carry_overlap=False)
    return chunks
