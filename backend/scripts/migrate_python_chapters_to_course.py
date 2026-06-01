"""Move misplaced Python chapter root knowledge points under one course node.

Default behavior is a dry run. Add --apply to commit.

Example:
    EXAM_DATABASE_URL=postgresql+asyncpg://... \
    uv run python scripts/migrate_python_chapters_to_course.py \
      --major-name "25医疗器械维护与管理" \
      --course-name "Python程序设计" \
      --confirm-count 10 \
      --apply
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.auth import models as _auth_models  # noqa: F401  # register User relationships
from app.common.data_visibility import VisibilityScope
from app.database import async_session
from app.learning.models import Direction, KnowledgePoint, Major
from app.questions import models as _question_models  # noqa: F401  # register question_knowledge_points
from app.rbac import models as _rbac_models  # noqa: F401  # register Class/UserOrganization relationships


DEFAULT_MAJOR_NAME = "25医疗器械维护与管理"
DEFAULT_COURSE_NAME = "Python程序设计"
DEFAULT_CHAPTER_REGEX = r"^第\d+章"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Safely move Python chapter root knowledge points under a Python course node.",
    )
    parser.add_argument("--major-name", default=DEFAULT_MAJOR_NAME, help="Exact major name to operate in.")
    parser.add_argument("--major-id", help="Optional major UUID. Use this if duplicate major names exist.")
    parser.add_argument("--direction-name", help="Optional exact direction name. Required if matches span directions.")
    parser.add_argument("--course-name", default=DEFAULT_COURSE_NAME, help="Course/root knowledge point name to create or reuse.")
    parser.add_argument(
        "--chapter-regex",
        default=DEFAULT_CHAPTER_REGEX,
        help="Regex for root chapter names when --chapter-name is not supplied.",
    )
    parser.add_argument(
        "--chapter-name",
        action="append",
        default=[],
        help="Exact chapter name to move. Can be repeated. If supplied, regex matching is ignored.",
    )
    parser.add_argument(
        "--confirm-count",
        type=int,
        help="Abort unless the number of matched root chapters equals this value.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit changes. Without this flag the script only prints the planned changes.",
    )
    return parser


def _matches_chapter(kp: KnowledgePoint, *, exact_names: set[str], pattern: re.Pattern[str]) -> bool:
    if exact_names:
        return kp.name in exact_names
    return bool(pattern.search(kp.name))


async def _load_major(major_id: str | None, major_name: str) -> Major:
    async with async_session() as session:
        stmt = select(Major).where(Major.deleted_at.is_(None))
        if major_id:
            stmt = stmt.where(Major.id == major_id)
        else:
            stmt = stmt.where(Major.name == major_name)

        majors = (await session.execute(stmt)).scalars().all()
        if not majors:
            raise SystemExit(f"No active major found for {major_id or major_name!r}.")
        if len(majors) > 1:
            ids = ", ".join(str(item.id) for item in majors)
            raise SystemExit(f"Found multiple majors named {major_name!r}; rerun with --major-id. ids={ids}")
        return majors[0]


async def migrate(args: argparse.Namespace) -> None:
    major = await _load_major(args.major_id, args.major_name)
    exact_names = {name.strip() for name in args.chapter_name if name.strip()}
    chapter_pattern = re.compile(args.chapter_regex)

    async with async_session() as session:
        directions_stmt = select(Direction).where(
            Direction.major_id == major.id,
            Direction.deleted_at.is_(None),
        )
        if args.direction_name:
            directions_stmt = directions_stmt.where(Direction.name == args.direction_name)
        directions = (await session.execute(directions_stmt)).scalars().all()
        if not directions:
            raise SystemExit("No active direction found for the selected major/filter.")
        direction_ids = {direction.id for direction in directions}
        direction_by_id = {direction.id: direction for direction in directions}

        root_stmt = (
            select(KnowledgePoint)
            .options(selectinload(KnowledgePoint.children))
            .where(
                KnowledgePoint.direction_id.in_(direction_ids),
                KnowledgePoint.parent_id.is_(None),
                KnowledgePoint.deleted_at.is_(None),
            )
            .order_by(KnowledgePoint.name)
        )
        root_points = (await session.execute(root_stmt)).scalars().all()
        candidates = [
            kp
            for kp in root_points
            if kp.name != args.course_name
            and _matches_chapter(kp, exact_names=exact_names, pattern=chapter_pattern)
        ]
        already_course = next((kp for kp in root_points if kp.name == args.course_name), None)

        if exact_names:
            found_names = {kp.name for kp in candidates}
            missing_names = sorted(exact_names - found_names)
            if missing_names:
                raise SystemExit(
                    "Some requested chapter names were not found as root knowledge points: "
                    + "；".join(missing_names)
                )

        candidate_direction_ids = {kp.direction_id for kp in candidates}
        if not candidates:
            if already_course is not None:
                children_stmt = select(KnowledgePoint).where(
                    KnowledgePoint.parent_id == already_course.id,
                    KnowledgePoint.deleted_at.is_(None),
                )
                children = (await session.execute(children_stmt)).scalars().all()
                print(f"No root chapters matched. Course already exists: {already_course.name} ({already_course.id})")
                print(f"Existing children under course: {len(children)}")
                return
            raise SystemExit("No matching root chapters found. Nothing to migrate.")

        if len(candidate_direction_ids) != 1:
            details = sorted(
                f"{direction_by_id.get(direction_id).name if direction_id in direction_by_id else direction_id}: "
                + ", ".join(kp.name for kp in candidates if kp.direction_id == direction_id)
                for direction_id in candidate_direction_ids
            )
            raise SystemExit(
                "Matched chapters span multiple directions; rerun with --direction-name.\n"
                + "\n".join(details)
            )

        direction_id = next(iter(candidate_direction_ids))
        direction = direction_by_id[direction_id]

        if args.confirm_count is not None and len(candidates) != args.confirm_count:
            raise SystemExit(
                f"Matched {len(candidates)} chapters, but --confirm-count is {args.confirm_count}. Aborting."
            )

        course_stmt = select(KnowledgePoint).where(
            KnowledgePoint.direction_id == direction.id,
            KnowledgePoint.parent_id.is_(None),
            KnowledgePoint.name == args.course_name,
            KnowledgePoint.deleted_at.is_(None),
        )
        courses = (await session.execute(course_stmt)).scalars().all()
        if len(courses) > 1:
            ids = ", ".join(str(item.id) for item in courses)
            raise SystemExit(f"Found multiple root course nodes named {args.course_name!r}; aborting. ids={ids}")
        course = courses[0] if courses else None

        if course is not None:
            child_names_stmt = select(KnowledgePoint.name).where(
                KnowledgePoint.parent_id == course.id,
                KnowledgePoint.deleted_at.is_(None),
            )
            existing_child_names = set((await session.execute(child_names_stmt)).scalars().all())
            duplicate_child_names = sorted(existing_child_names & {kp.name for kp in candidates})
            if duplicate_child_names:
                raise SystemExit(
                    "Course already has children with the same names; aborting to avoid duplicates: "
                    + "；".join(duplicate_child_names)
                )

        print("Migration plan")
        print(f"  major:     {major.name} ({major.id})")
        print(f"  direction: {direction.name} ({direction.id})")
        print(f"  course:    {args.course_name} ({course.id if course else 'will create'})")
        print(f"  chapters:  {len(candidates)}")
        for kp in candidates:
            child_count = len([child for child in kp.children if child.deleted_at is None])
            print(f"    - {kp.name} ({kp.id}) children={child_count}")

        if not args.apply:
            print("\nDry run only. Re-run with --apply to commit.")
            await session.rollback()
            return

        if course is None:
            template = candidates[0]
            course = KnowledgePoint(
                name=args.course_name,
                direction_id=direction.id,
                parent_id=None,
                description=f"{args.course_name}课程",
                owner_id=template.owner_id,
                visibility=template.visibility or VisibilityScope.PLATFORM,
                difficulty=template.difficulty or "中级",
            )
            session.add(course)
            await session.flush()
            print(f"\nCreated course node: {course.name} ({course.id})")

        for kp in candidates:
            kp.parent_id = course.id

        await session.commit()
        print(f"\nCommitted. Moved {len(candidates)} chapters under {course.name} ({course.id}).")


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    asyncio.run(migrate(args))


if __name__ == "__main__":
    main()
