"""Real DB + grading engine tests; model I/O is deterministic and never billed."""

import copy
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.chaoxing import service, worker
from app.chaoxing.models import ExternalAudit, ExternalItem
from app.chaoxing.schemas import ConfirmScore
from app.grading import service as grading
from app.grading.models import GradingResultSnapshot, GradingTask
from app.grading.providers.base import GradingProviderResult
from app.grading.seed import seed_grading_defaults

OWNER = uuid.uuid4()
COURSE = {"source_id": "course:cpi", "title": "课程"}
EXAM = {"source_id": "exam", "title": "考试", "submitted_count": 10}
CANDIDATE = {"source_id": "relation", "name": "测试考生姓名", "student_no": "0002026", "source_score": 1}
REVIEW = {
    "declared_max_score": 4.5,
    "questions": [
        {
            "source_id": "q1",
            "question_type": "简答题",
            "content": "说明循环作用",
            "student_answer": "重复执行",
            "reference_answer": "重复执行语句",
            "max_score": 2.5,
            "source_score": None,
            "objective": False,
            "requires_manual_review": False,
        },
        {
            "source_id": "q2",
            "question_type": "单选题",
            "content": "选择",
            "student_answer": "A",
            "reference_answer": "A",
            "max_score": 2,
            "source_score": 2,
            "objective": True,
            "requires_manual_review": False,
        },
    ],
}


async def save(db, review=None, owner=OWNER, account="account"):
    return await service.import_paper(db, owner, account, COURSE, EXAM, CANDIDATE, review or copy.deepcopy(REVIEW))


class FakeProvider:
    api_key = "test-only"

    def __init__(self):
        self.calls = []

    async def score(self, system_prompt, user_prompt):
        self.calls.append(user_prompt)
        return GradingProviderResult(
            raw_content={},
            score_total=2.25,
            dimension_scores={"correctness": 2.25},
            deduction_reasons=["表述略不完整"],
            strengths=[],
            improvement_suggestions=["补充执行条件"],
            evidence_summary={},
            risk_flags=[],
            dimension_comments={"correctness": "基本正确"},
        )


@pytest.fixture
async def configured(db_session, db_engine, monkeypatch):
    await seed_grading_defaults(db_session)
    await db_session.commit()
    fake = FakeProvider()
    monkeypatch.setattr(grading, "_build_provider_for_model", lambda model: fake)
    monkeypatch.setattr(worker.settings, "arbiter_enabled", False)
    return async_sessionmaker(db_engine, expire_on_commit=False), fake


async def test_durable_grading_dedup_confirmation_and_export(db_session, configured):
    factory, fake = configured
    candidate = await save(db_session)
    assert (await save(db_session)).id == candidate.id
    assert await db_session.scalar(select(func.count()).select_from(ExternalItem)) == 2
    assert (await service.enqueue(db_session, candidate.id, OWNER))["queued"] == 1
    assert (await service.enqueue(db_session, candidate.id, OWNER))["queued"] == 0
    await db_session.commit()
    job = await worker.claim(factory)
    assert job is not None and await worker.claim(factory) is None
    await worker.execute(job, factory)
    assert len(fake.calls) == 2  # primary + reviewer, objective doesn't call a model
    assert all(CANDIDATE["name"] not in p and CANDIDATE["student_no"] not in p for p in fake.calls)
    async with factory() as db:
        data = await service.detail(db, candidate.id, OWNER)
        item = data["items"][0]
        assert item["ai_score"] == 2.25 and item["max_score"] == 2.5
        assert item["status"] == "review" and item["feedback"]["deduction_reasons"]
        assert data["totals"]["final_score"] is None
        await service.confirm(
            db, candidate.id, item["id"], OWNER, ConfirmScore(version=item["version"], score=2.4, reason="教师复核")
        )
        assert (await service.detail(db, candidate.id, OWNER))["totals"]["final_score"] == 4.4
        with pytest.raises(HTTPException, match="409"):
            await service.confirm(db, candidate.id, item["id"], OWNER, ConfirmScore(version=item["version"], score=1))
        assert (await service.enqueue(db, candidate.id, OWNER))["queued"] == 0
        csv = (await service.export_csv(db, candidate.exam_id, OWNER)).decode("utf-8-sig")
        assert "'0002026" in csv and "4.4" in csv
        await db.commit()
    assert len(fake.calls) == 2
    async with factory() as db:
        assert await db.scalar(select(func.count()).select_from(GradingResultSnapshot)) >= 2
        audit = await db.scalar(select(ExternalAudit).where(ExternalAudit.action == "score.confirmed"))
        assert audit.actor_id == OWNER and audit.details["score"] == 2.4


async def test_revision_and_teacher_confirmation_survive_late_ai(db_session, configured):
    factory, fake = configured
    candidate = await save(db_session)
    await service.enqueue(db_session, candidate.id, OWNER)
    await db_session.commit()
    job = await worker.claim(factory)
    async with factory() as db:
        current = (await service.detail(db, candidate.id, OWNER))["items"][0]
        await service.confirm(
            db, candidate.id, current["id"], OWNER, ConfirmScore(version=current["version"], score=1.5)
        )
        await db.commit()
    await worker.execute(job, factory)
    async with factory() as db:
        result = await service.detail(db, candidate.id, OWNER)
        assert result["items"][0]["confirmed_score"] == 1.5
        assert result["items"][0]["status"] == "confirmed"
        changed = copy.deepcopy(REVIEW)
        changed["questions"][0]["student_answer"] = "更正后的答案"
        saved = await save(db, changed)
        assert saved.id == candidate.id and saved.revision == 2
        historical = await service.detail(db, candidate.id, OWNER, 1)
        assert historical["items"][0]["confirmed_score"] == 1.5 and historical["totals"] is None
        assert (await service.detail(db, candidate.id, OWNER))["totals"]["final_score"] is None
        await db.commit()


async def test_old_revision_worker_never_updates_new_paper(db_session, configured):
    factory, _ = configured
    candidate = await save(db_session)
    await service.enqueue(db_session, candidate.id, OWNER)
    await db_session.commit()
    job = await worker.claim(factory)
    async with factory() as db:
        changed = copy.deepcopy(REVIEW)
        changed["questions"][0]["student_answer"] = "新版"
        await save(db, changed)
        await db.commit()
    await worker.execute(job, factory)
    async with factory() as db:
        current = await service.detail(db, candidate.id, OWNER)
        assert current["revision"] == 2 and current["items"][0]["ai_score"] is None
        assert (await service.detail(db, candidate.id, OWNER, 1))["items"][0]["status"] == "obsolete"


async def test_owned_data_accounts_and_generic_task_guards(db_session, configured):
    a = await save(db_session)
    b = await save(db_session, account="another-account")
    c = await save(db_session, owner=uuid.uuid4())
    assert len({a.id, b.id, c.id}) == 3
    with pytest.raises(HTTPException) as exc:
        await service.detail(db_session, a.id, uuid.uuid4())
    assert exc.value.status_code == 404
    await service.enqueue(db_session, a.id, OWNER)
    task = await db_session.scalar(select(GradingTask))
    with pytest.raises(ValueError):
        await grading._ensure_task_access(db_session, task, current_user_id=OWNER, is_platform_admin=True)
    with pytest.raises(ValueError):
        await grading.create_grading_task(db_session, {"source_type": service.SOURCE}, is_platform_admin=True)
    assert (
        await grading._filter_tasks_by_exam_access(db_session, [task], current_user_id=OWNER, is_platform_admin=True)
        == []
    )


async def test_restart_marks_running_failed_keeps_queued(db_session, configured):
    factory, _ = configured
    candidate = await save(db_session)
    await service.enqueue(db_session, candidate.id, OWNER)
    await db_session.commit()
    await worker.recover(factory)
    job = await worker.claim(factory)
    assert job
    await worker.recover(factory)
    async with factory() as db:
        result = await service.detail(db, candidate.id, OWNER)
        assert result["items"][0]["status"] == "failed"
        assert (await service.enqueue(db, candidate.id, OWNER))["queued"] == 1
        await db.commit()


async def test_missing_information_manual_scoring_and_mismatch(db_session, configured):
    review = copy.deepcopy(REVIEW)
    review["questions"][0].update(max_score=None, requires_manual_review=True)
    review["questions"][1]["source_score"] = None
    candidate = await save(db_session, review)
    result = await service.detail(db_session, candidate.id, OWNER)
    assert all(i["status"] == "manual" for i in result["items"])
    assert result["totals"]["final_score"] is None and result["totals"]["resolved_count"] == 0
    assert (await service.enqueue(db_session, candidate.id, OWNER))["queued"] == 0
    item = result["items"][0]
    with pytest.raises(HTTPException) as exc:
        await service.confirm(
            db_session, candidate.id, item["id"], OWNER, ConfirmScore(version=1, score=3, max_score=2)
        )
    assert exc.value.status_code == 422
    await service.confirm(db_session, candidate.id, item["id"], OWNER, ConfirmScore(version=1, score=1, max_score=2))
    item = result["items"][1]
    await service.confirm(db_session, candidate.id, item["id"], OWNER, ConfirmScore(version=1, score=1))
    total = (await service.detail(db_session, candidate.id, OWNER))["totals"]
    assert total["resolved_count"] == 2 and total["score_mismatch"] and total["final_score"] is None


@pytest.mark.parametrize("value", ["=1+2", "+cmd", "-cmd", "@SUM(A1)", " \t=cmd"])
def test_csv_formula_safety(value):
    assert service.csv_cell(value).startswith("'")


async def test_model_failure_is_persisted_and_does_not_invent_zero(db_session, configured, monkeypatch):
    factory, fake = configured

    async def fail(*args):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(fake, "score", fail)
    candidate = await save(db_session)
    await service.enqueue(db_session, candidate.id, OWNER)
    await db_session.commit()
    await worker.execute(await worker.claim(factory), factory)
    async with factory() as db:
        data = await service.detail(db, candidate.id, OWNER)
        assert data["items"][0]["status"] == "failed" and data["items"][0]["ai_score"] is None
        assert data["totals"]["final_score"] is None


async def test_migration_creates_tables_and_can_run_after_create_all(db_engine):
    import importlib.util
    from pathlib import Path
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect
    from app.chaoxing.models import ExternalExam, ExternalCandidate

    migration_path = Path(__file__).parents[1] / "alembic/versions/20260920_add_chaoxing_grading.py"
    spec = importlib.util.spec_from_file_location("cx_migration", migration_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def verify(conn):
        for model in (ExternalAudit, ExternalItem, ExternalCandidate, ExternalExam):
            model.__table__.drop(conn)
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
            module.upgrade()  # Startup's create_all must not break upgrades.
        inspector = inspect(conn)
        assert set(("chaoxing_grading_exams", "chaoxing_grading_items")) <= set(inspector.get_table_names())
        assert (
            str(next(c for c in inspector.get_columns("grading_tasks") if c["name"] == "max_score")["type"]) == "FLOAT"
        )

    async with db_engine.begin() as conn:
        await conn.run_sync(verify)


async def test_recovery_reuses_committed_model_result_without_new_calls(db_session, configured):
    factory, fake = configured
    candidate = await save(db_session)
    await service.enqueue(db_session, candidate.id, OWNER)
    await db_session.commit()
    job = await worker.claim(factory)
    async with factory() as db:
        await grading.run_grading_task(db, str(job[1]), fake, fake, review_only_final=True)
        await db.commit()  # Crash here: snapshots committed; item still running.
    await worker.recover(factory)
    async with factory() as db:
        result = await service.detail(db, candidate.id, OWNER)
        assert result["items"][0]["ai_score"] == 2.25 and result["items"][0]["status"] == "review"
        assert (await service.enqueue(db, candidate.id, OWNER))["queued"] == 0
    assert len(fake.calls) == 2


async def test_import_requires_latest_server_snapshot(db_session, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from app.chaoxing import router as routes
    from app.chaoxing.browser import Session, manager
    from app.chaoxing.schemas import ImportPaper

    session = Session(
        owner=str(OWNER), context=SimpleNamespace(close=AsyncMock()), page=None, connected=True, account_key="account"
    )
    co = session.remember("course", [COURSE])[0]
    ex = session.remember("exam", [EXAM], co["id"])[0]
    ca = session.remember("candidate", [CANDIDATE], ex["id"])[0]
    session.record(ca["id"], "candidate")["_review"] = copy.deepcopy(REVIEW)
    monkeypatch.setattr(manager, "sessions", {session.id: session})
    with pytest.raises(HTTPException) as exc:
        await routes.save_paper(
            session.id,
            ca["id"],
            ImportPaper(review_hash="0" * 64, completeness_confirmed=True),
            SimpleNamespace(id=OWNER),
            db_session,
        )
    assert exc.value.status_code == 409
    saved = await routes.save_paper(
        session.id,
        ca["id"],
        ImportPaper(review_hash=service.fingerprint(REVIEW), completeness_confirmed=True),
        SimpleNamespace(id=OWNER),
        db_session,
    )
    assert saved["revision"] == 1
    assert await db_session.scalar(select(func.count()).select_from(ExternalItem)) == 2
