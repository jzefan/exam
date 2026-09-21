"""A durable, serial queue under the connector's single-process lock."""

import asyncio
import logging

from sqlalchemy import select

from app.config import settings
from app.database import async_session
from app.grading import service as grading
from app.grading.models import GradingResultSnapshot, GradingTask
from .models import ExternalCandidate, ExternalItem
from .service import SOURCE

logger = logging.getLogger(__name__)


async def recover(factory=async_session):
    async with factory() as db:
        interrupted = (await db.scalars(select(ExternalItem).where(ExternalItem.status == "running"))).all()
        for item in interrupted:
            candidate = await db.get(ExternalCandidate, item.candidate_id)
            task = None
            if item.task_id:
                task = await db.get(GradingTask, item.task_id)
            snapshot = (
                await db.get(GradingResultSnapshot, task.latest_final_snapshot_id)
                if task and task.status == "completed" and task.latest_final_snapshot_id
                else None
            )
            if candidate.revision != item.revision:
                item.status = "obsolete"
            elif snapshot:
                # A crash between the two commits must not trigger another paid call.
                item.ai_score, item.status, item.error = snapshot.score_total, "review", ""
            else:
                item.status = "failed"
                item.error = "服务重启中断了评分，请检查后重试（此前调用可能已计费）"
            item.version += 1
            if task and not snapshot:
                task.status = "failed"
        await db.commit()


async def claim(factory=async_session):
    async with factory() as db:
        # Lock in the same candidate -> item order as enqueue/import/confirm.
        candidate = await db.scalar(
            select(ExternalCandidate)
            .where(
                ExternalCandidate.id.in_(select(ExternalItem.candidate_id).where(ExternalItem.status == "queued")),
            )
            .order_by(ExternalCandidate.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if candidate is None:
            return None
        item = await db.scalar(
            select(ExternalItem)
            .where(
                ExternalItem.candidate_id == candidate.id,
                ExternalItem.status == "queued",
            )
            .order_by(ExternalItem.position)
            .limit(1)
        )
        if item.revision != candidate.revision:
            item.status = "obsolete"
            await db.commit()
            return None
        item.status = "running"
        item.version += 1
        claim_data = (item.id, item.task_id, item.version, candidate.id, item.revision)
        await db.commit()
        return claim_data


async def execute(claim_data, factory=async_session):
    item_id, task_id, version, candidate_id, revision = claim_data
    score, error = None, ""
    try:
        async with asyncio.timeout(360):
            async with factory() as db:
                task = await db.get(GradingTask, task_id)
                if task is None or task.source_type != SOURCE:
                    raise ValueError("invalid source task")
                binding = await grading._load_role_binding(db, task.role_binding_version)
                await grading.run_grading_task(
                    db,
                    str(task_id),
                    grading._build_provider_for_model(binding.grader_model),
                    grading._build_provider_for_model(binding.reviewer_model),
                    grading._build_optional_provider_for_model(binding.arbiter_model)
                    if settings.arbiter_enabled
                    else None,
                    "zh-CN",
                    review_only_final=not settings.arbiter_enabled,
                )
                if task.status == "completed" and task.latest_final_snapshot_id:
                    snapshot = await db.get(GradingResultSnapshot, task.latest_final_snapshot_id)
                    score = snapshot.score_total
                else:
                    error = "模型评分失败，请稍后重试或人工评分"
                await db.commit()
    except Exception:
        # Detailed provider diagnostics, when available, stay in grading audits.
        # Never surface raw provider responses or source/student content in logs.
        logger.warning("Chaoxing grading task failed: %s", task_id)
        error = "模型评分失败或超时，请稍后重试或人工评分"
    async with factory() as db:
        candidate = await db.scalar(
            select(ExternalCandidate).where(ExternalCandidate.id == candidate_id).with_for_update()
        )
        item = await db.get(ExternalItem, item_id)
        # Late results cannot replace a teacher's confirmation or a newer paper.
        if (
            candidate.revision == revision
            and item.task_id == task_id
            and item.version == version
            and item.status == "running"
        ):
            item.ai_score, item.error = score, error
            item.status = "failed" if error else "review"
            item.version += 1
        elif item.status == "running" and candidate.revision != revision:
            item.status = "obsolete"
            item.version += 1
        if error:
            task = await db.get(GradingTask, task_id)
            if task:
                task.status = "failed"
        await db.commit()


async def run():
    while True:
        try:
            await recover()
            break
        except Exception:
            logger.warning("Chaoxing grading recovery temporarily unavailable")
            await asyncio.sleep(2)
    while True:
        try:
            job = await claim()
            if job:
                await execute(job)
                continue
        except Exception:
            logger.warning("Chaoxing grading queue temporarily unavailable")
        await asyncio.sleep(2)
