"""Normalize soft line breaks that document import leaves in question text.

The import pipeline is `docx -> text -> LLM -> html`. Word's soft line wraps
(Shift+Enter, or any line the reader would call "just wrapped") survive as
`<br>` in the html and as newlines in the plain-text twin, so a question renders
as "…子网掩码、⏎ 的 IP 地址…" instead of one sentence.

The rule is deliberately conservative — a break is dropped only when it cannot
be a paragraph boundary:

    keep   after 。！？；：      a real paragraph/sentence break
    keep   before A. ① （1） 1、 a new list item
    drop   everything else      a wrap in the middle of a sentence

When both sides are ASCII a space is kept so Latin words and table names do not
fuse; CJK needs no separator.

Applied at the import boundary only (draft -> persisted content), never to
hand-edited content, and never to code questions or `<pre>`/`<code>` blocks
where line breaks are significant.
"""

from __future__ import annotations

import re
from typing import Any

BR = re.compile(r"<br\s*/?>", re.I)
TAG = re.compile(r"<[^>]+>")
PRE_BLOCK = re.compile(r"<(?:pre|code)\b", re.I)
END_PUNCT = set("。！？；：!?;:")
ITEM_START = re.compile(r"^(?:[A-Da-d][.、)）]|[①②③④⑤⑥⑦⑧⑨⑩]|[（(]\d+[)）]|\d+[.、)])")

# Types whose line breaks are content, not layout.
_LINE_BREAK_SAFE_TYPES = {"code"}


def _keep_break(before: str, after: str) -> bool:
    if not before or not after:
        return True
    if before[-1] in END_PUNCT:
        return True
    return bool(ITEM_START.match(after))


def _separator(before: str, after: str) -> str:
    """Space only between ASCII neighbours ("tb_a(..)" + "tb_b(..)")."""
    if before and after and before.isascii() and after.isascii():
        return " "
    return ""


def normalize_html_breaks(html: str) -> str:
    if not BR.search(html) or PRE_BLOCK.search(html):
        return html
    pieces: list[str] = []
    last = 0
    for match in BR.finditer(html):
        pieces.append(html[last : match.start()])
        before = TAG.sub("", html[: match.start()]).rstrip()
        after = TAG.sub("", html[match.end() :]).lstrip()
        if _keep_break(before, after):
            pieces.append(match.group(0))
        else:
            pieces.append(_separator(before[-1:], after[:1]))
        last = match.end()
    pieces.append(html[last:])
    return "".join(pieces)


def normalize_text_breaks(text: str) -> str:
    if "\n" not in text:
        return text
    lines = text.split("\n")
    out: list[str] = [lines[0]]
    for line in lines[1:]:
        before = out[-1].rstrip()
        after = line.lstrip()
        if _keep_break(before, after):
            out[-1] = before
            out.append(after)
        else:
            out[-1] = before + _separator(before[-1:], after[:1]) + after
    return "\n".join(out)


def split_soft_wrapped_paragraphs(text: str) -> list[str]:
    """Group raw import lines into logical paragraphs.

    Importers that emit one `<p>` per source line turn every wrapped line into a
    paragraph; grouping first keeps wrapped lines inside the same paragraph.
    Blank lines are respected as real paragraph separators.
    """
    paragraphs: list[str] = []
    current = ""

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if current:
                paragraphs.append(current)
                current = ""
            continue
        if line.startswith("<img "):
            if current:
                paragraphs.append(current)
                current = ""
            paragraphs.append(line)
            continue
        if not current:
            current = line
            continue
        if current[-1] in END_PUNCT or ITEM_START.match(line):
            paragraphs.append(current)
            current = line
            continue
        current += _separator(current[-1:], line[:1]) + line
    if current:
        paragraphs.append(current)
    return paragraphs


def normalize_question_content(
    content: dict[str, Any], *, question_type: str | None = None
) -> dict[str, Any]:
    """Return a copy of a question `content` dict with import breaks normalized."""
    if question_type and str(question_type).lower() in _LINE_BREAK_SAFE_TYPES:
        return content
    if not isinstance(content, dict):
        return content
    normalized = dict(content)
    html = normalized.get("html")
    if isinstance(html, str) and html:
        normalized["html"] = normalize_html_breaks(html)
    text = normalized.get("text")
    if isinstance(text, str) and text:
        normalized["text"] = normalize_text_breaks(text)
    return normalized
