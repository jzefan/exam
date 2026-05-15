import importlib.util
import uuid
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import selectinload

from app.grading.models import (
    GradingAuditEvent,
    GradingResultSnapshot,
    GradingTask,
    ModelConfig,
    ProviderConfig,
    RoleBinding,
)
from app.grading.seed import seed_grading_defaults

POSTGRES_TEST_DATABASE_URL = "postgresql+asyncpg://exam:exam@127.0.0.1:5432/exam"


def _load_grading_migration_module():
    migration_path = Path(__file__).resolve().parents[2] / "alembic" / "versions" / "add_grading_trust_core.py"
    spec = importlib.util.spec_from_file_location("grading_migration_test_module", migration_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_grading_migration_upgrade(sync_conn, schema: str) -> None:
    migration_module = _load_grading_migration_module()
    sync_conn.execute(text(f'SET search_path TO "{schema}"'))
    context = MigrationContext.configure(sync_conn)
    with Operations.context(context):
        migration_module.upgrade()


@pytest.mark.asyncio
async def test_create_grading_task_with_snapshot_and_audit(db_session: AsyncSession) -> None:
    provider = ProviderConfig(
        key="qwen-direct",
        provider_type="qwen",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        credential_env="EXAM_QWEN_API_KEY",
        is_active=True,
    )
    db_session.add(provider)
    await db_session.flush()

    model = ModelConfig(
        key="qwen-grader-v1",
        display_name="Qwen Grader",
        model_name="qwen-plus",
        provider_id=provider.id,
        temperature=0.1,
        is_active=True,
    )
    db_session.add(model)
    await db_session.flush()

    binding = RoleBinding(
        version=1,
        grader_model_id=model.id,
        reviewer_model_id=model.id,
        arbiter_model_id=model.id,
        is_active=True,
    )
    db_session.add(binding)
    await db_session.flush()

    task = GradingTask(
        source_type="single_debug",
        question_type="code",
        question_content="实现 two sum",
        max_score=100,
        student_answer_raw="def two_sum(nums, target): return []",
        standard_answers=[{"summary": "返回正确下标"}],
        rubric_definition={"dimensions": [{"key": "correctness", "weight": 0.4}]},
        role_binding_version=binding.version,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    snapshot = GradingResultSnapshot(
        task_id=task.id,
        snapshot_type="primary",
        score_total=55,
        dimension_scores={"correctness": 20},
        evidence_summary={"tests_passed": 1, "tests_total": 3},
        risk_flags=["low_correctness"],
        model_config_id=model.id,
        provider_config_id=provider.id,
        prompt_template_version="grading-v1",
        role_binding_version=binding.version,
        created_by="system",
    )
    db_session.add(snapshot)
    await db_session.flush()
    task.latest_primary_snapshot = snapshot

    audit = GradingAuditEvent(
        task_id=task.id,
        event_type="task.created",
        event_payload={"source_type": "single_debug"},
        operator_type="system",
        operator_id="system",
    )
    db_session.add(audit)
    await db_session.commit()

    result = await db_session.execute(
        select(GradingTask)
        .options(
            selectinload(GradingTask.snapshots),
            selectinload(GradingTask.audit_events),
            selectinload(GradingTask.latest_primary_snapshot),
        )
        .where(GradingTask.id == task.id)
    )
    saved_task = result.scalar_one()

    assert saved_task.question_type == "code"
    assert saved_task.role_binding_version == 1
    assert saved_task.latest_primary_snapshot_id == snapshot.id
    assert saved_task.latest_primary_snapshot is not None
    assert saved_task.latest_primary_snapshot.id == snapshot.id
    assert saved_task.latest_primary_snapshot.snapshot_type == "primary"
    assert len(saved_task.snapshots) == 1
    assert saved_task.snapshots[0].task_id == saved_task.id
    assert saved_task.snapshots[0].provider_config_id == provider.id
    assert saved_task.snapshots[0].evidence_summary == {"tests_passed": 1, "tests_total": 3}
    assert len(saved_task.audit_events) == 1
    assert saved_task.audit_events[0].task_id == saved_task.id
    assert saved_task.audit_events[0].event_type == "task.created"
    assert saved_task.audit_events[0].event_payload == {"source_type": "single_debug"}

    other_task = GradingTask(
        source_type="single_debug",
        question_type="code",
        question_content="实现 reverse list",
        max_score=100,
        student_answer_raw="def reverse_list(items): return items",
        standard_answers=[{"summary": "返回翻转后的数组"}],
        rubric_definition={"dimensions": [{"key": "correctness", "weight": 0.4}]},
        role_binding_version=binding.version,
        status="pending",
    )
    db_session.add(other_task)
    await db_session.flush()

    other_snapshot = GradingResultSnapshot(
        task_id=other_task.id,
        snapshot_type="primary",
        score_total=88,
        dimension_scores={"correctness": 35},
        evidence_summary={"tests_passed": 3, "tests_total": 3},
        risk_flags=[],
        model_config_id=model.id,
        provider_config_id=provider.id,
        prompt_template_version="grading-v1",
        role_binding_version=binding.version,
        created_by="system",
    )
    db_session.add(other_snapshot)
    await db_session.flush()

    saved_task.latest_primary_snapshot_id = other_snapshot.id
    with pytest.raises(ValueError, match="same grading task"):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_postgres_db_constraints_reject_cross_task_latest_snapshot_pointer() -> None:
    schema = f"grading_task2_{uuid.uuid4().hex}"
    engine = create_async_engine(POSTGRES_TEST_DATABASE_URL, echo=False)

    provider_id = uuid.uuid4()
    model_id = uuid.uuid4()
    task_one_id = uuid.uuid4()
    task_two_id = uuid.uuid4()
    snapshot_two_id = uuid.uuid4()

    try:
        async with engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))

        async with engine.begin() as conn:
            await conn.run_sync(lambda sync_conn: _run_grading_migration_upgrade(sync_conn, schema))

        async with engine.begin() as conn:
            await conn.execute(text(f'SET search_path TO "{schema}"'))
            await conn.execute(
                text(
                    """
                    INSERT INTO grading_provider_configs (
                        id, key, provider_type, base_url, credential_env, is_active
                    ) VALUES (
                        :id, :key, :provider_type, :base_url, :credential_env, :is_active
                    )
                    """
                ),
                {
                    "id": provider_id,
                    "key": "pg-qwen-direct",
                    "provider_type": "qwen",
                    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "credential_env": "EXAM_QWEN_API_KEY",
                    "is_active": True,
                },
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO grading_model_configs (
                        id, key, display_name, model_name, provider_id, temperature, is_active
                    ) VALUES (
                        :id, :key, :display_name, :model_name, :provider_id, :temperature, :is_active
                    )
                    """
                ),
                {
                    "id": model_id,
                    "key": "pg-qwen-grader-v1",
                    "display_name": "Qwen Grader",
                    "model_name": "qwen-plus",
                    "provider_id": provider_id,
                    "temperature": 0.1,
                    "is_active": True,
                },
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO grading_role_bindings (
                        id, version, grader_model_id, reviewer_model_id, arbiter_model_id, is_active
                    ) VALUES (
                        :id, :version, :grader_model_id, :reviewer_model_id, :arbiter_model_id, :is_active
                    )
                    """
                ),
                {
                    "id": uuid.uuid4(),
                    "version": 1,
                    "grader_model_id": model_id,
                    "reviewer_model_id": model_id,
                    "arbiter_model_id": model_id,
                    "is_active": True,
                },
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO grading_tasks (
                        id, source_type, status, question_type, question_content, max_score,
                        knowledge_tags, fatal_rule_enabled, student_answer_raw, attachment_refs,
                        standard_answers, rubric_definition, scoring_points, dimension_weights,
                        deduction_rules, fatal_error_rules, runtime_logs, role_binding_version
                    ) VALUES (
                        :id, :source_type, :status, :question_type, :question_content, :max_score,
                        :knowledge_tags, :fatal_rule_enabled, :student_answer_raw, :attachment_refs,
                        :standard_answers, :rubric_definition, :scoring_points, :dimension_weights,
                        :deduction_rules, :fatal_error_rules, :runtime_logs, :role_binding_version
                    )
                    """
                ),
                {
                    "id": task_one_id,
                    "source_type": "single_debug",
                    "status": "pending",
                    "question_type": "code",
                    "question_content": "task one",
                    "max_score": 100,
                    "knowledge_tags": "[]",
                    "fatal_rule_enabled": True,
                    "student_answer_raw": "print('one')",
                    "attachment_refs": "[]",
                    "standard_answers": '[{"summary":"one"}]',
                    "rubric_definition": '{"dimensions":[{"key":"correctness","weight":0.4}]}',
                    "scoring_points": "[]",
                    "dimension_weights": "{}",
                    "deduction_rules": "[]",
                    "fatal_error_rules": "[]",
                    "runtime_logs": "[]",
                    "role_binding_version": 1,
                },
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO grading_tasks (
                        id, source_type, status, question_type, question_content, max_score,
                        knowledge_tags, fatal_rule_enabled, student_answer_raw, attachment_refs,
                        standard_answers, rubric_definition, scoring_points, dimension_weights,
                        deduction_rules, fatal_error_rules, runtime_logs, role_binding_version
                    ) VALUES (
                        :id, :source_type, :status, :question_type, :question_content, :max_score,
                        :knowledge_tags, :fatal_rule_enabled, :student_answer_raw, :attachment_refs,
                        :standard_answers, :rubric_definition, :scoring_points, :dimension_weights,
                        :deduction_rules, :fatal_error_rules, :runtime_logs, :role_binding_version
                    )
                    """
                ),
                {
                    "id": task_two_id,
                    "source_type": "single_debug",
                    "status": "pending",
                    "question_type": "code",
                    "question_content": "task two",
                    "max_score": 100,
                    "knowledge_tags": "[]",
                    "fatal_rule_enabled": True,
                    "student_answer_raw": "print('two')",
                    "attachment_refs": "[]",
                    "standard_answers": '[{"summary":"two"}]',
                    "rubric_definition": '{"dimensions":[{"key":"correctness","weight":0.4}]}',
                    "scoring_points": "[]",
                    "dimension_weights": "{}",
                    "deduction_rules": "[]",
                    "fatal_error_rules": "[]",
                    "runtime_logs": "[]",
                    "role_binding_version": 1,
                },
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO grading_result_snapshots (
                        id, task_id, snapshot_type, score_total, dimension_scores, deduction_reasons,
                        strengths, improvement_suggestions, evidence_summary, risk_flags,
                        provider_config_id, model_config_id, prompt_template_version,
                        role_binding_version, created_by
                    ) VALUES (
                        :id, :task_id, :snapshot_type, :score_total, :dimension_scores, :deduction_reasons,
                        :strengths, :improvement_suggestions, :evidence_summary, :risk_flags,
                        :provider_config_id, :model_config_id, :prompt_template_version,
                        :role_binding_version, :created_by
                    )
                    """
                ),
                {
                    "id": snapshot_two_id,
                    "task_id": task_two_id,
                    "snapshot_type": "primary",
                    "score_total": 91,
                    "dimension_scores": '{"correctness":36}',
                    "deduction_reasons": "[]",
                    "strengths": "[]",
                    "improvement_suggestions": "[]",
                    "evidence_summary": '{"tests_passed":3,"tests_total":3}',
                    "risk_flags": "[]",
                    "provider_config_id": provider_id,
                    "model_config_id": model_id,
                    "prompt_template_version": "grading-v1",
                    "role_binding_version": 1,
                    "created_by": "system",
                },
            )

        async with engine.connect() as conn:
            await conn.execute(text(f'SET search_path TO "{schema}"'))
            with pytest.raises(Exception) as exc_info:
                await conn.execute(
                    text(
                        """
                        UPDATE grading_tasks
                        SET latest_primary_snapshot_id = :snapshot_id
                        WHERE id = :task_id
                        """
                    ),
                    {
                        "snapshot_id": snapshot_two_id,
                        "task_id": task_one_id,
                    },
                )
            await conn.rollback()

        assert "fk_grading_tasks_latest_primary_snapshot_owner" in str(exc_info.value)
    finally:
        async with engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()


def test_latest_snapshot_relationship_rejects_cross_task_object_graph() -> None:
    task_one = GradingTask(
        source_type="single_debug",
        question_type="code",
        question_content="task one",
        max_score=100,
        student_answer_raw="print('one')",
        standard_answers=[{"summary": "one"}],
        rubric_definition={"dimensions": [{"key": "correctness", "weight": 0.4}]},
        role_binding_version=1,
        status="pending",
    )
    task_two = GradingTask(
        source_type="single_debug",
        question_type="code",
        question_content="task two",
        max_score=100,
        student_answer_raw="print('two')",
        standard_answers=[{"summary": "two"}],
        rubric_definition={"dimensions": [{"key": "correctness", "weight": 0.4}]},
        role_binding_version=1,
        status="pending",
    )
    snapshot_two = GradingResultSnapshot(
        task=task_two,
        snapshot_type="primary",
        score_total=91,
        dimension_scores={"correctness": 36},
        evidence_summary={"tests_passed": 3, "tests_total": 3},
        risk_flags=[],
        role_binding_version=1,
        created_by="system",
    )

    with pytest.raises(ValueError, match="same grading task"):
        task_one.latest_primary_snapshot = snapshot_two


@pytest.mark.asyncio
async def test_seed_grading_defaults_is_idempotent(db_session: AsyncSession) -> None:
    await seed_grading_defaults(db_session)
    await seed_grading_defaults(db_session)

    providers = (await db_session.execute(select(ProviderConfig))).scalars().all()
    models = (await db_session.execute(select(ModelConfig))).scalars().all()
    bindings = (await db_session.execute(select(RoleBinding))).scalars().all()

    assert sorted(provider.key for provider in providers) == [
        "deepseek-direct",
        "doubao-arbiter",
        "openrouter-arbiter",
        "qwen-direct",
    ]
    assert sorted(model.key for model in models) == [
        "deepseek-review-v1",
        "doubao-arbiter-v1",
        "qwen-grader-v1",
    ]
    assert [(binding.version, binding.is_active) for binding in bindings] == [(1, True)]

    provider_envs = {provider.key: provider.credential_env for provider in providers}
    assert provider_envs["qwen-direct"] == "EXAM_QWEN_API_KEY"
    assert provider_envs["deepseek-direct"] == "EXAM_DEEPSEEK_API_KEY"
    assert provider_envs["doubao-arbiter"] == "EXAM_DOUBAO_API_KEY"


@pytest.mark.asyncio
async def test_seed_grading_defaults_syncs_default_model_names_from_settings(db_session: AsyncSession) -> None:
    provider = ProviderConfig(
        key="doubao-arbiter",
        provider_type="doubao",
        base_url="https://ark.cn-beijing.volces.com/api/v3",
        credential_env="EXAM_DOUBAO_API_KEY",
        is_active=True,
    )
    db_session.add(provider)
    await db_session.flush()

    model = ModelConfig(
        key="doubao-arbiter-v1",
        display_name="Doubao Seed 2.0 Lite",
        model_name="doubao-seed-2-0-lite-260428",
        provider_id=provider.id,
        temperature=0.0,
        is_active=True,
    )
    db_session.add(model)
    await db_session.flush()

    from app.grading import seed as grading_seed

    original_model_name = grading_seed.settings.doubao_model_name
    grading_seed.settings.doubao_model_name = "doubao-seed-2-0-lite-260428"
    try:
        await seed_grading_defaults(db_session)
    finally:
        grading_seed.settings.doubao_model_name = original_model_name

    await db_session.refresh(model)
    assert model.model_name == "doubao-seed-2-0-lite-260428"
    assert model.display_name == "Doubao Seed 2.0 Lite"
