"""Bulk-create N stress-test students and enroll them into an exam.

Creates users directly via the DB (bypasses /register so it's fast), assigns
the `student` role + given org, then inserts ExamStudent rows so the cohort
can POST /api/student/exams/{exam_id}/start immediately.

Outputs a CSV (`username,password`) consumable by `stress_test_exam.py`.

Usage:
    PYTHONPATH=src .venv/bin/python scripts/seed_stress_students.py \\
        --exam-id <uuid> \\
        --count 200 \\
        --prefix stress \\
        --password stress123 \\
        --output users.csv

Idempotent on username: pre-existing users with the same prefix are reused
(their password is reset to the provided one so the CSV is always valid).
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import sys
import uuid
from typing import Any

from sqlalchemy import select

from app.auth.models import User
from app.auth.security import hash_password
from app.database import async_session
from app.exams.models import Exam, ExamStudent
from app.rbac.models import Organization, Role, UserOrganization


async def _get_or_create_student_role(db: Any) -> Role:
    result = await db.execute(select(Role).where(Role.name == "student"))
    role = result.scalar_one_or_none()
    if role is None:
        raise RuntimeError("role 'student' missing — run the backend once to seed RBAC")
    return role


async def _resolve_org(db: Any, exam_id: uuid.UUID) -> Organization:
    """Use the exam owner's org so permissions match production students."""
    exam = (await db.execute(select(Exam).where(Exam.id == exam_id))).scalar_one_or_none()
    if exam is None:
        raise RuntimeError(f"exam {exam_id} not found")
    owner_org = (
        await db.execute(
            select(Organization).join(UserOrganization, UserOrganization.org_id == Organization.id).where(
                UserOrganization.user_id == exam.owner_id
            )
        )
    ).scalars().first()
    if owner_org is None:
        # fallback: any org
        owner_org = (await db.execute(select(Organization))).scalars().first()
    if owner_org is None:
        raise RuntimeError("no organization available — seed one first")
    return owner_org


async def seed(args: argparse.Namespace) -> int:
    exam_id = uuid.UUID(args.exam_id)
    password_hash = hash_password(args.password)

    created_or_reused: list[tuple[str, str]] = []

    async with async_session() as db:
        role = await _get_or_create_student_role(db)
        org = await _resolve_org(db, exam_id)

        # Pre-fetch existing users with this prefix so we don't collide on unique username.
        prefix_like = f"{args.prefix}%"
        existing_rows = (
            await db.execute(select(User).where(User.username.like(prefix_like)))
        ).scalars().all()
        existing = {u.username: u for u in existing_rows}

        # Pre-fetch existing enrollment so we only insert missing rows.
        enrolled_rows = (
            await db.execute(
                select(ExamStudent.student_id).where(ExamStudent.exam_id == exam_id)
            )
        ).scalars().all()
        enrolled_ids = set(enrolled_rows)

        new_user_orgs: list[UserOrganization] = []
        new_exam_students: list[ExamStudent] = []

        for idx in range(1, args.count + 1):
            username = f"{args.prefix}{idx:04d}"
            user = existing.get(username)
            if user is None:
                user = User(
                    id=uuid.uuid4(),
                    username=username,
                    email=f"optional+{username}.{uuid.uuid4().hex[:12]}@optional.local",
                    password_hash=password_hash,
                    full_name=f"Stress {idx:04d}",
                )
                db.add(user)
                await db.flush()  # get user.id
                new_user_orgs.append(
                    UserOrganization(user_id=user.id, org_id=org.id, role_id=role.id)
                )
            else:
                # reset password so CSV is authoritative
                user.password_hash = password_hash

            if user.id not in enrolled_ids:
                new_exam_students.append(ExamStudent(exam_id=exam_id, student_id=user.id))
                enrolled_ids.add(user.id)

            created_or_reused.append((username, args.password))

        if new_user_orgs:
            db.add_all(new_user_orgs)
        if new_exam_students:
            db.add_all(new_exam_students)

        await db.commit()

    with open(args.output, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        for row in created_or_reused:
            writer.writerow(row)

    print(
        f"seeded {args.count} students ({len(created_or_reused)} rows written to {args.output}); "
        f"enrolled into exam {exam_id}"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Seed stress-test students + enroll them in an exam")
    p.add_argument("--exam-id", required=True)
    p.add_argument("--count", type=int, default=200)
    p.add_argument("--prefix", default="stress")
    p.add_argument("--password", default="stress123")
    p.add_argument("--output", default="users.csv")
    return p


def main() -> int:
    args = build_parser().parse_args()
    return asyncio.run(seed(args))


if __name__ == "__main__":
    sys.exit(main())
