#!/usr/bin/env python
"""Collapse spurious hard line breaks in imported question HTML.

The import pipeline goes `docx -> text -> LLM -> html`. Soft line breaks in the
source Word file survive as `<br>` (and as newlines in `content.text`), so
questions render as "…子网掩码、⏎ 的 IP 地址…" instead of one sentence.

Rule (deliberately conservative):

    keep the break   when it follows 。！？；：            -> real paragraph break
    keep the break   when the next chunk starts an item  -> A. / ① / （1） / 1、
    drop the break   otherwise                            -> mid-sentence wrap

When the two sides are ASCII alphanumerics a single space is kept so English
words do not fuse.

Usage (inside the backend image so it picks up the app's models and DB env):

    python scripts/normalize_question_breaks.py                    # dry run
    python scripts/normalize_question_breaks.py --apply --backup /path/out.jsonl

The backup holds one JSON object per affected question with its original
`content`, which is enough to restore the row with a single UPDATE.
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import json
import re
import sys
from typing import Any

import app.main  # noqa: F401  (registers every ORM mapper before we query)
from sqlalchemy import select, update

from app.database import async_session
from app.questions.models import Question

BR = re.compile(r"<br\s*/?>", re.I)
TAG = re.compile(r"<[^>]+>")
END_PUNCT = set("。！？；：!?;:")
ITEM_START = re.compile(r"^(?:[A-Da-d][.、)）]|[①②③④⑤⑥⑦⑧⑨⑩]|[（(]\d+[)）]|\d+[.、)])")


def _decide(before: str, after: str) -> tuple[bool, str]:
    """Return (keep_break, reason) for a break with these two visible sides."""
    if not before or not after:
        return True, "edge"
    last = before[-1]
    if last in END_PUNCT:
        return True, "after_sentence_punct"
    if ITEM_START.match(after):
        return True, "list_item"
    return False, "joined"


def _separator(before: str, after: str) -> str:
    """Space only when both sides are ASCII, so Latin text/table names do not fuse.

    Chinese needs no separator ("子网掩码、" + "的 IP 地址"), but
    "tb_department(...)" + "tb_registration(...)" must not become one token.
    """
    if before and after and before.isascii() and after.isascii():
        return " "
    return ""


def normalize_html(html: str) -> tuple[str, list[tuple[str, str]]]:
    if not BR.search(html):
        return html, []
    pieces: list[str] = []
    changes: list[tuple[str, str]] = []
    last = 0
    for match in BR.finditer(html):
        pieces.append(html[last : match.start()])
        before = TAG.sub("", html[: match.start()]).rstrip()
        after = TAG.sub("", html[match.end() :]).lstrip()
        keep, reason = _decide(before, after)
        pieces.append(match.group(0) if keep else _separator(before[-1:], after[:1]))
        changes.append((reason, _context(before, after)))
        last = match.end()
    pieces.append(html[last:])
    return "".join(pieces), changes


def normalize_text(text: str) -> tuple[str, list[tuple[str, str]]]:
    """Same rule for the plain-text twin, which keeps newlines instead of <br>."""
    if "\n" not in text:
        return text, []
    lines = text.split("\n")
    out: list[str] = [lines[0]]
    changes: list[tuple[str, str]] = []
    for line in lines[1:]:
        before = out[-1].rstrip()
        after = line.lstrip()
        keep, reason = _decide(before, after)
        if keep:
            out[-1] = before
            out.append(after)
        else:
            out[-1] = before + _separator(before[-1:], after[:1]) + after
        changes.append((reason, _context(before, after)))
    return "\n".join(out), changes


def _context(before: str, after: str, span: int = 12) -> str:
    return f"...{before[-span:]}[BREAK]{after[:span]}..."


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    parser.add_argument("--backup", default="", help="write affected rows here as JSONL before applying")
    parser.add_argument("--types", default="", help="comma separated question types, e.g. fill_in,essay")
    parser.add_argument("--samples", type=int, default=6)
    args = parser.parse_args()
    if args.apply and not args.backup:
        parser.error("--apply requires --backup so the change stays reversible")

    wanted = {t.strip().lower() for t in args.types.split(",") if t.strip()}

    async with async_session() as db:
        rows = (
            await db.execute(select(Question).where(Question.deleted_at.is_(None)))
        ).scalars().all()

        stats: collections.Counter[str] = collections.Counter()
        joined_by_type: collections.Counter[str] = collections.Counter()
        samples: list[tuple[Any, str, str]] = []
        updates: list[tuple[Question, dict[str, Any]]] = []

        for question in rows:
            qtype = question.type.value if hasattr(question.type, "value") else str(question.type)
            if wanted and qtype.lower() not in wanted:
                continue
            content = question.content if isinstance(question.content, dict) else {}
            new_content = dict(content)
            for field, normalizer in (("html", normalize_html), ("text", normalize_text)):
                raw = content.get(field)
                if not isinstance(raw, str) or not raw:
                    continue
                normalized, changes = normalizer(raw)
                for reason, context in changes:
                    stats[reason] += 1
                    if reason == "joined":
                        joined_by_type[qtype] += 1
                        if field == "html" and len(samples) < args.samples:
                            samples.append((question.id, qtype, context))
                if normalized != raw:
                    new_content[field] = normalized
            if new_content != content:
                updates.append((question, new_content))

        if args.apply and updates:
            with open(args.backup, "w", encoding="utf-8") as handle:
                for question, _new_content in updates:
                    handle.write(
                        json.dumps(
                            {
                                "id": str(question.id),
                                "content": question.content,
                                "updated_at": question.updated_at.isoformat()
                                if question.updated_at
                                else None,
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
            for question, new_content in updates:
                # Writing `updated_at` back keeps the repair invisible to
                # "recently edited" ordering (the column has onupdate=now()).
                await db.execute(
                    update(Question)
                    .where(Question.id == question.id)
                    .values(content=new_content, updated_at=question.updated_at)
                )
            await db.commit()

    print("mode:", "APPLY" if args.apply else "DRY-RUN")
    print("questions touched:", len(updates))
    print("break decisions:", dict(stats))
    print("joined by type:", dict(joined_by_type))
    if args.apply and updates:
        print("backup:", args.backup)
    for question_id, qtype, context in samples:
        print(f"  [{qtype}] {question_id} {context}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
