"""Safely re-link existing exams/practices to a teacher-owned course.

Default behavior is a dry run. Add --apply to commit.

Example:
    python /app/scripts/reassign_exams_to_course.py \
      --teacher-username eshyong \
      --course-name "大数据分析" \
      --exam-title "大数据分析技术复习题5.13 · 2026-05-13" \
      --exam-title "大数据分析技术-2025-2026第二学期期末考试" \
      --update-owner \
      --apply
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from sqlalchemy import select

from app.auth.models import User
from app.database import async_session
from app.exams.models import Exam
from app.learning.models import Direction, KnowledgePoint, Major
from app.questions import models as _question_models  # noqa: F401  # register Question relationships
from app.rbac import models as _rbac_models  # noqa: F401  # register Class/UserOrganization relationships
from app.teacher_courses.models import CourseSemester, ExamSemesterAssignment


DEFAULT_TEACHER_USERNAME = "eshyong"
DEFAULT_COURSE_NAME = "大数据分析"
DEFAULT_EXAM_TITLES = [
    "大数据分析技术复习题5.13 · 2026-05-13 练习",
    "大数据分析技术-2025-2026第二学期期末考试",
]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Safely re-link existing exams/practices to a course and optional semester.",
    )
    parser.add_argument("--teacher-username", default=DEFAULT_TEACHER_USERNAME)
    parser.add_argument("--course-name", default=DEFAULT_COURSE_NAME)
    parser.add_argument("--course-id", help="Course/root knowledge point UUID. Required if duplicate names exist.")
    parser.add_argument(
        "--semester-name",
        help="Course semester name. Required if the course has multiple active semesters and --semester-id is omitted.",
    )
    parser.add_argument("--semester-id", help="Course semester UUID.")
    parser.add_argument(
        "--exam-title",
        action="append",
        default=[],
        help="Exact exam/practice title to re-link. Can be repeated. Defaults to the known big-data exams.",
    )
    parser.add_argument(
        "--exam-id",
        action="append",
        default=[],
        help="Exam UUID to re-link. Can be repeated. Use this if duplicate titles exist.",
    )
    parser.add_argument(
        "--expected-count",
        type=int,
        default=2,
        help="Abort unless this many exams are matched. Set to 0 to disable.",
    )
    parser.add_argument(
        "--update-owner",
        action="store_true",
        help="Also set exams.owner_id to the teacher. Required on --apply if current owner differs.",
    )
    parser.add_argument(
        "--update-creator",
        action="store_true",
        help="Also set exams.created_by to the teacher. Usually not needed unless creator display is wrong.",
    )
    parser.add_argument("--apply", action="store_true", help="Commit changes. Without this flag it only prints a plan.")
    return parser


def _uuid(value: str | None, label: str) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise SystemExit(f"Invalid {label}: {value}") from exc


def _user_label(user: User | None) -> str:
    if user is None:
        return "<missing user>"
    return f"{user.username} / {user.full_name} ({user.id})"


async def _load_teacher(username: str) -> User:
    async with async_session() as session:
        stmt = select(User).where(
            User.username == username,
            User.deleted_at.is_(None),
        )
        users = (await session.execute(stmt)).scalars().all()
        if not users:
            raise SystemExit(f"No active teacher user found for username={username!r}.")
        if len(users) > 1:
            ids = ", ".join(str(user.id) for user in users)
            raise SystemExit(f"Found multiple users for username={username!r}; aborting. ids={ids}")
        return users[0]


async def _load_course(args: argparse.Namespace, teacher: User) -> KnowledgePoint:
    course_id = _uuid(args.course_id, "--course-id")
    async with async_session() as session:
        stmt = select(KnowledgePoint).where(KnowledgePoint.deleted_at.is_(None))
        if course_id is not None:
            stmt = stmt.where(KnowledgePoint.id == course_id)
        else:
            stmt = stmt.where(
                KnowledgePoint.name == args.course_name,
                KnowledgePoint.owner_id == teacher.id,
            )
        courses = (await session.execute(stmt)).scalars().all()
        if not courses:
            raise SystemExit(
                f"No active course knowledge point found for course={args.course_name!r}, owner={teacher.username!r}."
            )
        if len(courses) > 1:
            details = []
            for course in courses:
                direction = await session.get(Direction, course.direction_id) if course.direction_id else None
                major = await session.get(Major, direction.major_id) if direction else None
                details.append(
                    f"{course.id} name={course.name!r} parent={course.parent_id} "
                    f"direction={direction.name if direction else None!r} major={major.name if major else None!r}"
                )
            raise SystemExit("Found multiple matching courses; rerun with --course-id:\n" + "\n".join(details))
        return courses[0]


async def _resolve_semester(args: argparse.Namespace, course: KnowledgePoint) -> CourseSemester | None:
    semester_id = _uuid(args.semester_id, "--semester-id")
    async with async_session() as session:
        stmt = select(CourseSemester).where(
            CourseSemester.course_id == course.id,
            CourseSemester.deleted_at.is_(None),
        )
        if semester_id is not None:
            stmt = stmt.where(CourseSemester.id == semester_id)
        elif args.semester_name:
            stmt = stmt.where(CourseSemester.name == args.semester_name)
        semesters = (await session.execute(stmt)).scalars().all()

        if semester_id is not None or args.semester_name:
            if not semesters:
                raise SystemExit("No active course semester matched the supplied semester filter.")
            if len(semesters) > 1:
                ids = ", ".join(str(item.id) for item in semesters)
                raise SystemExit(f"Found multiple semesters for filter; rerun with --semester-id. ids={ids}")
            return semesters[0]

        if not semesters:
            print("No active semester found for the course; only exams.course_kp_id will be updated.")
            return None
        if len(semesters) == 1:
            return semesters[0]

        details = "\n".join(f"{item.id}  {item.name}" for item in semesters)
        raise SystemExit(
            "Course has multiple active semesters; rerun with --semester-name or --semester-id:\n" + details
        )


async def _load_exams(args: argparse.Namespace) -> list[Exam]:
    exam_ids = [_uuid(item, "--exam-id") for item in args.exam_id]
    titles = [title.strip() for title in (args.exam_title or []) if title.strip()] or DEFAULT_EXAM_TITLES
    async with async_session() as session:
        if exam_ids:
            stmt = select(Exam).where(Exam.id.in_(exam_ids), Exam.deleted_at.is_(None))
            exams = (await session.execute(stmt)).scalars().all()
            found_ids = {exam.id for exam in exams}
            missing = [str(item) for item in exam_ids if item is not None and item not in found_ids]
            if missing:
                raise SystemExit("Some --exam-id values were not found: " + ", ".join(missing))
        else:
            exams = []
            for title in titles:
                rows = (
                    await session.execute(
                        select(Exam).where(
                            Exam.title == title,
                            Exam.deleted_at.is_(None),
                        )
                    )
                ).scalars().all()
                if not rows:
                    raise SystemExit(f"No active exam/practice found for title={title!r}.")
                if len(rows) > 1:
                    details = "\n".join(
                        f"{row.id} category={row.category} owner_id={row.owner_id} created_by={row.created_by}"
                        for row in rows
                    )
                    raise SystemExit(
                        f"Found multiple exams/practices titled {title!r}; rerun with --exam-id:\n{details}"
                    )
                exams.append(rows[0])

        if args.expected_count and len(exams) != args.expected_count:
            raise SystemExit(
                f"Matched {len(exams)} exams/practices, but --expected-count is {args.expected_count}. Aborting."
            )
        return exams


async def migrate(args: argparse.Namespace) -> None:
    teacher = await _load_teacher(args.teacher_username)
    course = await _load_course(args, teacher)
    semester = await _resolve_semester(args, course)
    exams = await _load_exams(args)

    async with async_session() as session:
        current_owner_ids = {exam.owner_id for exam in exams}
        users_by_id = {
            user.id: user
            for user in (
                await session.execute(select(User).where(User.id.in_(current_owner_ids)))
            ).scalars().all()
        }
        assignments = {
            item.exam_id: item
            for item in (
                await session.execute(
                    select(ExamSemesterAssignment).where(
                        ExamSemesterAssignment.exam_id.in_([exam.id for exam in exams])
                    )
                )
            ).scalars().all()
        }

        owner_mismatches = [exam for exam in exams if exam.owner_id != teacher.id]
        if args.apply and owner_mismatches and not args.update_owner:
            details = "\n".join(
                f"{exam.id} {exam.title!r} owner={_user_label(users_by_id.get(exam.owner_id))}"
                for exam in owner_mismatches
            )
            raise SystemExit(
                "Some exams are not owned by the target teacher. Rerun with --update-owner if this is intended:\n"
                + details
            )

        print("Re-link plan")
        print(f"  teacher:  {_user_label(teacher)}")
        print(f"  course:   {course.name} ({course.id})")
        print(f"  semester: {semester.name + ' ' if semester else ''}({semester.id if semester else 'none'})")
        print(f"  exams:    {len(exams)}")
        for exam in exams:
            assignment = assignments.get(exam.id)
            owner = users_by_id.get(exam.owner_id)
            print(f"    - {exam.title} ({exam.id})")
            print(f"      category={exam.category} status={exam.status} total_score={exam.total_score}")
            print(f"      owner={_user_label(owner)}")
            print(f"      current_course_kp_id={exam.course_kp_id}")
            print(f"      target_course_kp_id={course.id}")
            print(f"      current_semester_id={assignment.course_semester_id if assignment else None}")
            print(f"      target_semester_id={semester.id if semester else None}")

        if not args.apply:
            print("\nDry run only. Re-run with --apply to commit.")
            await session.rollback()
            return

        db_exams = (
            await session.execute(select(Exam).where(Exam.id.in_([exam.id for exam in exams])))
        ).scalars().all()
        for exam in db_exams:
            exam.course_kp_id = course.id
            if args.update_owner:
                exam.owner_id = teacher.id
            if args.update_creator:
                exam.created_by = teacher.id

            assignment = assignments.get(exam.id)
            if semester is None:
                continue
            if assignment is None:
                session.add(ExamSemesterAssignment(exam_id=exam.id, course_semester_id=semester.id))
            else:
                assignment.course_semester_id = semester.id

        await session.commit()
        print(f"\nCommitted. Re-linked {len(db_exams)} exams/practices to course {course.name} ({course.id}).")


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    asyncio.run(migrate(args))


if __name__ == "__main__":
    main()
