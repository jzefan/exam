"""Owned, versioned grading snapshots. Never creates student accounts or writes upstream."""

import csv
import hashlib
import io
import json
import math
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.grading import service as grading
from app.grading.models import GradingAuditEvent, GradingResultSnapshot, GradingTask, RoleBinding
from .models import ExternalAudit, ExternalCandidate, ExternalExam, ExternalItem
from .question_types import ai_type, is_objective

SOURCE = "chaoxing_submission"


def fingerprint(review: dict) -> str:
    return hashlib.sha256(json.dumps(review, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()).hexdigest()


def valid_score(score, maximum) -> bool:
    return (
        isinstance(score, (int, float))
        and isinstance(maximum, (int, float))
        and math.isfinite(score)
        and math.isfinite(maximum)
        and 0 <= score <= maximum
    )


async def owned_candidate(db, candidate_id, owner_id, *, lock=False):
    query = (
        select(ExternalCandidate)
        .join(ExternalExam)
        .where(
            ExternalCandidate.id == candidate_id,
            ExternalExam.owner_id == owner_id,
            ExternalCandidate.deleted_at.is_(None),
            ExternalExam.deleted_at.is_(None),
        )
    )
    if lock:
        query = query.with_for_update(of=ExternalCandidate)
    candidate = await db.scalar(query.execution_options(populate_existing=True))
    if candidate is None:
        raise HTTPException(404, "未找到已保存答卷")
    return candidate


async def current_items(db, candidate):
    return list(
        (
            await db.scalars(
                select(ExternalItem)
                .where(
                    ExternalItem.candidate_id == candidate.id,
                    ExternalItem.revision == candidate.revision,
                )
                .order_by(ExternalItem.position)
                .execution_options(populate_existing=True)
            )
        ).all()
    )


def audit(db, candidate, owner, action, *, item=None, **details):
    db.add(
        ExternalAudit(
            candidate_id=candidate.id,
            item_id=item.id if item else None,
            actor_id=owner,
            action=action,
            details={"revision": candidate.revision, **details},
        )
    )


async def import_paper(
    db: AsyncSession, owner, account_key, course, exam, source, review, *, completeness_confirmed=True,
):
    if not account_key or not source.get("student_no") or not source.get("name"):
        raise HTTPException(409, "请重新验证连接，并确认考生姓名和学号已完整读取")
    # Imports from one source session are serialized by BrowserManager.hold; the
    # uniqueness constraints also prevent duplication across sessions/processes.
    saved_exam = await db.scalar(
        select(ExternalExam).where(
            ExternalExam.owner_id == owner,
            ExternalExam.account_key == account_key,
            ExternalExam.course_key == course["source_id"],
            ExternalExam.source_exam_id == exam["source_id"],
        )
    )
    if saved_exam is None:
        saved_exam = ExternalExam(
            owner_id=owner,
            account_key=account_key,
            course_key=course["source_id"],
            source_exam_id=exam["source_id"],
            course_title=course["title"],
            title=exam["title"],
            expected_submitted=exam.get("submitted_count"),
        )
        db.add(saved_exam)
        await db.flush()
    candidate = await db.scalar(
        select(ExternalCandidate)
        .where(
            ExternalCandidate.exam_id == saved_exam.id,
            ExternalCandidate.source_candidate_id == source["source_id"],
        )
        .with_for_update()
    )
    digest = fingerprint(review)
    if candidate and candidate.content_hash == digest:
        if completeness_confirmed and not candidate.completeness_confirmed:
            candidate.completeness_confirmed = True
            audit(db, candidate, owner, "paper.completeness_confirmed")
            await db.flush()
        return candidate
    if candidate is None:
        candidate = ExternalCandidate(
            exam_id=saved_exam.id,
            source_candidate_id=source["source_id"],
            name=source["name"],
            student_no=source["student_no"],
            revision=0,
        )
        db.add(candidate)
        await db.flush()
    else:
        for item in await current_items(db, candidate):
            if item.status == "queued":
                item.status = "obsolete"
                item.version += 1
    candidate.revision += 1
    candidate.name, candidate.student_no = source["name"], source["student_no"]
    candidate.source_score = source.get("source_score")
    candidate.content_hash = digest
    candidate.declared_max_score = review.get("declared_max_score")
    candidate.completeness_confirmed = completeness_confirmed
    for position, q in enumerate(review["questions"], 1):
        maximum = q["max_score"]
        if not isinstance(maximum, (int, float)) or not math.isfinite(maximum) or maximum < 0:
            maximum = None
        source_score = q["source_score"] if valid_score(q["source_score"], maximum) else None
        # The label is the authority when this reader recognizes it; otherwise the
        # provider's own `objective` class decides. A question the provider already
        # marked must never end up in the AI queue, and a subjective one must not be
        # silently kept out of it either.
        objective_by_label = is_objective(q["question_type"])
        objective = q["objective"] if objective_by_label is None else objective_by_label
        manual = (
            q["requires_manual_review"]
            or not maximum
            or not q["content"]
            or not q["reference_answer"]
            or not ai_type(q["question_type"], q["content"])
        )
        status = (
            ("source" if source_score is not None else "manual")
            if objective
            else ("manual" if manual else "pending")
        )
        db.add(
            ExternalItem(
                candidate_id=candidate.id,
                revision=candidate.revision,
                position=position,
                question_id=q["source_id"],
                question_type=q["question_type"],
                content=q["content"],
                student_answer=q["student_answer"],
                reference_answer=q["reference_answer"],
                max_score=maximum,
                objective=objective,
                source_score=source_score,
                requires_manual_review=manual,
                status=status,
            )
        )
    audit(db, candidate, owner, "paper.imported", hash=digest, question_count=len(review["questions"]))
    await db.flush()
    return candidate


async def active_binding(db):
    version = await db.scalar(
        select(RoleBinding.version).where(RoleBinding.is_active.is_(True)).order_by(RoleBinding.version.desc()).limit(1)
    )
    if version is None:
        raise HTTPException(409, "请管理员先配置主评和复核模型")
    try:
        binding = await grading._load_role_binding(db, version)
        for model in (binding.grader_model, binding.reviewer_model):
            provider = grading._build_provider_for_model(model)
            if not provider.api_key:
                raise ValueError("missing credential")
        return binding
    except ValueError:
        raise HTTPException(409, "主评或复核模型尚未配置可用的密钥，请联系管理员") from None


async def enqueue(db, candidate_id, owner):
    candidate = await owned_candidate(db, candidate_id, owner, lock=True)
    items = [i for i in await current_items(db, candidate) if i.status in ("pending", "failed")]
    if not items:
        return {"queued": 0}
    binding = await active_binding(db)
    for item in items:
        question_type = ai_type(item.question_type, item.content)
        task = GradingTask(
            source_type=SOURCE,
            source_business_id=str(item.id),
            status="pending",
            question_type=question_type,
            question_content=item.content,
            student_answer_raw=item.student_answer,
            max_score=item.max_score,
            language="zh-CN",
            role_binding_version=binding.version,
            fatal_rule_enabled=False,
            standard_answers=[{"answer": item.reference_answer}],
            rubric_definition={
                "dimensions": [{"key": "correctness", "label": "正确性与完整性", "max_score": item.max_score}]
            },
            dimension_weights={"correctness": 1},
            execution_env={"mode": "static_review", "executed": False} if question_type == "code" else None,
        )
        db.add(task)
        await db.flush()
        item.task_id, item.status, item.error = task.id, "queued", ""
        item.version += 1
        db.add(
            GradingAuditEvent(
                task_id=task.id,
                event_type="task.created",
                operator_type="teacher",
                operator_id=str(owner),
                event_payload={"source_type": SOURCE},
            )
        )
        audit(db, candidate, owner, "grading.queued", item=item, task_id=str(task.id), binding_version=binding.version)
    await db.flush()
    return {"queued": len(items)}


async def confirm(db, candidate_id, item_id, owner, payload):
    candidate = await owned_candidate(db, candidate_id, owner, lock=True)
    item = next((i for i in await current_items(db, candidate) if i.id == item_id), None)
    if item is None:
        raise HTTPException(404, "题目已更新，请刷新答卷")
    if item.version != payload.version:
        raise HTTPException(409, "分数状态已更新，请刷新后再确认")
    maximum = item.max_score if item.max_score is not None else payload.max_score
    if not valid_score(payload.score, maximum):
        raise HTTPException(422, "请填写题目满分，确认分须在 0 至满分之间")
    previous = item.confirmed_score
    item.max_score, item.confirmed_score = maximum, round(payload.score, 2)
    item.status, item.comment = "confirmed", payload.reason
    item.confirmed_at, item.confirmed_by = datetime.now(timezone.utc), owner
    item.version += 1
    audit(
        db,
        candidate,
        owner,
        "score.confirmed",
        item=item,
        previous_score=previous,
        score=item.confirmed_score,
        max_score=maximum,
        reason=payload.reason,
        ai_score=item.ai_score,
    )
    await db.flush()


def totals(candidate, items):
    resolved = [
        i.confirmed_score if i.confirmed_score is not None else i.source_score if i.objective else None for i in items
    ]
    maximum = round(sum(i.max_score or 0 for i in items), 2)
    mismatch = candidate.declared_max_score is not None and abs(maximum - candidate.declared_max_score) > 0.01
    complete = (
        bool(items)
        and candidate.completeness_confirmed
        and all(i.max_score is not None for i in items)
        and not mismatch
    )
    return {
        "question_count": len(items),
        "resolved_count": sum(v is not None for v in resolved),
        "objective_score": round(
            sum(
                i.confirmed_score if i.confirmed_score is not None else i.source_score or 0
                for i in items
                if i.objective
            ),
            2,
        ),
        "ai_subjective_score": round(sum(i.ai_score or 0 for i in items if not i.objective), 2),
        "ai_graded_count": sum(i.ai_score is not None for i in items),
        "confirmed_subtotal": round(sum(v for v in resolved if v is not None), 2),
        "final_score": round(sum(resolved), 2) if complete and all(v is not None for v in resolved) else None,
        "max_score": maximum if all(i.max_score is not None for i in items) else None,
        "declared_max_score": candidate.declared_max_score,
        "score_mismatch": mismatch,
    }


async def detail(db, candidate_id, owner, revision=None):
    candidate = await owned_candidate(db, candidate_id, owner)
    selected_revision = revision if revision is not None else candidate.revision
    if selected_revision < 1 or selected_revision > candidate.revision:
        raise HTTPException(404, "答卷版本不存在")
    items = list(
        (
            await db.scalars(
                select(ExternalItem)
                .where(
                    ExternalItem.candidate_id == candidate.id,
                    ExternalItem.revision == selected_revision,
                )
                .order_by(ExternalItem.position)
            )
        ).all()
    )
    exam = await db.get(ExternalExam, candidate.exam_id)
    rows = []
    for item in items:
        row = {
            key: getattr(item, key)
            for key in (
                "id",
                "position",
                "question_type",
                "content",
                "student_answer",
                "reference_answer",
                "max_score",
                "objective",
                "source_score",
                "ai_score",
                "confirmed_score",
                "status",
                "version",
                "comment",
                "error",
                "requires_manual_review",
            )
        }
        row["feedback"] = None
        if item.task_id:
            task = await db.get(GradingTask, item.task_id)
            row["binding_version"] = task.role_binding_version
            snapshot = (
                await db.get(GradingResultSnapshot, task.latest_final_snapshot_id)
                if task.latest_final_snapshot_id
                else None
            )
            if snapshot:
                row["feedback"] = {
                    k: getattr(snapshot, k)
                    for k in (
                        "dimension_comments",
                        "deduction_reasons",
                        "strengths",
                        "improvement_suggestions",
                        "risk_flags",
                    )
                }
        rows.append(row)
    audits = list(
        (
            await db.scalars(
                select(ExternalAudit)
                .where(ExternalAudit.candidate_id == candidate.id)
                .order_by(ExternalAudit.created_at.desc())
            )
        ).all()
    )
    return {
        "id": candidate.id,
        "exam_id": candidate.exam_id,
        "name": candidate.name,
        "student_no": candidate.student_no,
        "exam_title": exam.title,
        "course_title": exam.course_title,
        "revision": selected_revision,
        "current_revision": candidate.revision,
        "completeness_confirmed": candidate.completeness_confirmed,
        "source_score": candidate.source_score,
        "totals": totals(candidate, items) if selected_revision == candidate.revision else None,
        "items": rows,
        "audit": [
            {"action": a.action, "actor_id": a.actor_id, "created_at": a.created_at, "details": a.details}
            for a in audits
        ],
    }


async def exam_rows(db, owner):
    exams = (
        await db.scalars(
            select(ExternalExam)
            .where(ExternalExam.owner_id == owner, ExternalExam.deleted_at.is_(None))
            .order_by(ExternalExam.created_at.desc())
        )
    ).all()
    result = []
    for exam in exams:
        candidates = (
            await db.scalars(
                select(ExternalCandidate)
                .where(ExternalCandidate.exam_id == exam.id, ExternalCandidate.deleted_at.is_(None))
                .order_by(ExternalCandidate.student_no)
            )
        ).all()
        result.append(
            {
                "id": exam.id,
                "title": exam.title,
                "course_title": exam.course_title,
                "expected_submitted": exam.expected_submitted,
                "candidates": [
                    {
                        "id": c.id,
                        "name": c.name,
                        "student_no": c.student_no,
                        "revision": c.revision,
                        "totals": totals(c, await current_items(db, c)),
                    }
                    for c in candidates
                ],
            }
        )
    return result


def csv_cell(value):
    value = str(value) if value is not None else ""
    # Keep identifiers as text and neutralize spreadsheet formulas, including
    # formula prefixes hidden behind whitespace/control characters.
    return "'" + value if value.lstrip(" \t\r\n\x00").startswith(("=", "+", "-", "@")) else value


async def export_csv(db, exam_id, owner):
    exams = await exam_rows(db, owner)
    exam = next((e for e in exams if e["id"] == exam_id), None)
    if exam is None:
        raise HTTPException(404, "未找到已保存考试")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["课程", "考试", "姓名", "学号", "版本", "已确认小计", "最终成绩", "已处理题数", "题数"])
    for c in exam["candidates"]:
        t = c["totals"]
        writer.writerow(
            [
                csv_cell(exam["course_title"]),
                csv_cell(exam["title"]),
                csv_cell(c["name"]),
                "'" + c["student_no"],
                c["revision"],
                t["confirmed_subtotal"],
                t["final_score"],
                t["resolved_count"],
                t["question_count"],
            ]
        )
    return output.getvalue().encode("utf-8-sig")
