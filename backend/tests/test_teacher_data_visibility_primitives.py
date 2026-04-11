import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Column, DateTime, ForeignKey, MetaData, String, Table, Text, Uuid, inspect, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.auth.models import User
from app.common.data_visibility import VisibilityScope
from app.exams.models import Exam
from app.learning.models import KnowledgePoint
from app.questions.models import Question, QuestionBank

POSTGRES_TEST_DATABASE_URL = "postgresql+asyncpg://exam:exam@127.0.0.1:5432/exam"
SCHEMA_USER_A = uuid.UUID("11111111-1111-1111-1111-111111111111")
SCHEMA_USER_B = uuid.UUID("22222222-2222-2222-2222-222222222222")
LINKED_BANK_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
FALLBACK_BANK_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
LINKED_QUESTION_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")
EXAM_QUESTION_ID = uuid.UUID("66666666-6666-6666-6666-666666666666")
LINKED_KP_ID = uuid.UUID("77777777-7777-7777-7777-777777777777")
FALLBACK_KP_ID = uuid.UUID("88888888-8888-8888-8888-888888888888")
EXAM_ID = uuid.UUID("99999999-9999-9999-9999-999999999999")


def test_visibility_scope_members() -> None:
    assert VisibilityScope.PRIVATE.value == "private"
    assert VisibilityScope.PLATFORM.value == "platform"


def test_teacher_data_visibility_model_metadata() -> None:
    model_columns = {
        QuestionBank: ("owner_id", "visibility"),
        Question: ("owner_id",),
        KnowledgePoint: ("owner_id", "visibility"),
        Exam: ("owner_id",),
    }

    for model, column_names in model_columns.items():
        for column_name in column_names:
            assert model.__table__.c[column_name].nullable is False
            if column_name == "owner_id":
                assert model.__table__.c[column_name].references(User.__table__.c.id)


@pytest.mark.asyncio
async def test_teacher_data_visibility_database_schema(db_engine) -> None:
    async with db_engine.begin() as conn:
        schema = await conn.run_sync(
            lambda sync_conn: {
                table_name: {
                    "columns": {
                        column["name"]: column for column in inspect(sync_conn).get_columns(table_name)
                    },
                    "foreign_keys": inspect(sync_conn).get_foreign_keys(table_name),
                }
                for table_name in ("question_banks", "questions", "knowledge_points", "exams")
            }
        )

    assert "owner_id" in schema["question_banks"]["columns"]
    assert schema["question_banks"]["columns"]["owner_id"]["nullable"] is False
    assert "visibility" in schema["question_banks"]["columns"]
    assert schema["question_banks"]["columns"]["visibility"]["nullable"] is False

    assert "owner_id" in schema["questions"]["columns"]
    assert schema["questions"]["columns"]["owner_id"]["nullable"] is False

    assert "owner_id" in schema["knowledge_points"]["columns"]
    assert schema["knowledge_points"]["columns"]["owner_id"]["nullable"] is False
    assert "visibility" in schema["knowledge_points"]["columns"]
    assert schema["knowledge_points"]["columns"]["visibility"]["nullable"] is False

    assert "owner_id" in schema["exams"]["columns"]
    assert schema["exams"]["columns"]["owner_id"]["nullable"] is False

    for table_name in ("question_banks", "questions", "knowledge_points", "exams"):
        assert any(
            fk["constrained_columns"] == ["owner_id"]
            and fk["referred_table"] == "users"
            and fk["referred_columns"] == ["id"]
            for fk in schema[table_name]["foreign_keys"]
        )


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260411_teacher_data_visibility_primitives.py"
    )
    spec = importlib.util.spec_from_file_location("teacher_data_visibility_primitives_revision", migration_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_pre_migration_schema(sync_conn, schema_name: str) -> None:
    metadata = MetaData()

    users = Table(
        "users",
        metadata,
        Column("id", Uuid, primary_key=True, nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False),
        schema=schema_name,
    )
    question_banks = Table(
        "question_banks",
        metadata,
        Column("id", Uuid, primary_key=True, nullable=False),
        Column("name", String(200), nullable=False),
        Column("description", Text(), nullable=True),
        schema=schema_name,
    )
    questions = Table(
        "questions",
        metadata,
        Column("id", Uuid, primary_key=True, nullable=False),
        Column("created_by", Uuid, ForeignKey(f"{schema_name}.users.id"), nullable=False),
        Column("question_bank_id", Uuid, ForeignKey(f"{schema_name}.question_banks.id"), nullable=True),
        schema=schema_name,
    )
    knowledge_points = Table(
        "knowledge_points",
        metadata,
        Column("id", Uuid, primary_key=True, nullable=False),
        Column("name", String(200), nullable=False),
        schema=schema_name,
    )
    question_knowledge_points = Table(
        "question_knowledge_points",
        metadata,
        Column("question_id", Uuid, ForeignKey(f"{schema_name}.questions.id"), primary_key=True, nullable=False),
        Column(
            "knowledge_point_id",
            Uuid,
            ForeignKey(f"{schema_name}.knowledge_points.id"),
            primary_key=True,
            nullable=False,
        ),
        schema=schema_name,
    )
    exams = Table(
        "exams",
        metadata,
        Column("id", Uuid, primary_key=True, nullable=False),
        Column("created_by", Uuid, ForeignKey(f"{schema_name}.users.id"), nullable=False),
        schema=schema_name,
    )

    metadata.create_all(sync_conn)

    sync_conn.execute(
        users.insert(),
        [
            {"id": SCHEMA_USER_A, "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc)},
            {"id": SCHEMA_USER_B, "created_at": datetime(2026, 1, 2, tzinfo=timezone.utc)},
        ],
    )
    sync_conn.execute(
        question_banks.insert(),
        [
            {"id": LINKED_BANK_ID, "name": "Linked Bank", "description": None},
            {"id": FALLBACK_BANK_ID, "name": "Fallback Bank", "description": None},
        ],
    )
    sync_conn.execute(
        knowledge_points.insert(),
        [
            {"id": LINKED_KP_ID, "name": "Linked KP"},
            {"id": FALLBACK_KP_ID, "name": "Fallback KP"},
        ],
    )
    sync_conn.execute(
        questions.insert(),
        [
            {
                "id": LINKED_QUESTION_ID,
                "created_by": SCHEMA_USER_B,
                "question_bank_id": LINKED_BANK_ID,
            },
            {
                "id": EXAM_QUESTION_ID,
                "created_by": SCHEMA_USER_B,
                "question_bank_id": None,
            },
        ],
    )
    sync_conn.execute(
        question_knowledge_points.insert(),
        [
            {"question_id": LINKED_QUESTION_ID, "knowledge_point_id": LINKED_KP_ID},
        ],
    )
    sync_conn.execute(
        exams.insert(),
        [
            {"id": EXAM_ID, "created_by": SCHEMA_USER_B},
        ],
    )


def _run_revision(sync_conn, module, fn_name: str) -> None:
    context = MigrationContext.configure(sync_conn)
    operations = Operations(context)
    previous_op = module.op
    module.op = operations
    try:
        getattr(module, fn_name)()
    finally:
        module.op = previous_op


@pytest.mark.asyncio
async def test_teacher_data_visibility_revision_upgrade_and_downgrade() -> None:
    schema_name = f"tvv_{uuid.uuid4().hex}"
    module = _load_migration_module()
    engine = create_async_engine(POSTGRES_TEST_DATABASE_URL, echo=False)

    try:
        async with engine.begin() as conn:
            await conn.exec_driver_sql(f'CREATE SCHEMA "{schema_name}"')
            await conn.exec_driver_sql(f'SET search_path TO "{schema_name}"')
            await conn.run_sync(lambda sync_conn: _create_pre_migration_schema(sync_conn, schema_name))
            await conn.run_sync(lambda sync_conn: _run_revision(sync_conn, module, "upgrade"))

            schema = await conn.run_sync(
                lambda sync_conn: {
                    table_name: {
                        "columns": {
                            column["name"]: column
                            for column in inspect(sync_conn).get_columns(table_name, schema=schema_name)
                        },
                        "foreign_keys": inspect(sync_conn).get_foreign_keys(table_name, schema=schema_name),
                        "rows": sync_conn.execute(
                            text(f'SELECT * FROM "{schema_name}"."{table_name}" ORDER BY id')
                        ).mappings().all(),
                    }
                    for table_name in ("question_banks", "questions", "knowledge_points", "exams")
                }
            )

            assert schema["question_banks"]["columns"]["owner_id"]["nullable"] is False
            assert schema["question_banks"]["columns"]["visibility"]["nullable"] is False
            assert schema["questions"]["columns"]["owner_id"]["nullable"] is False
            assert schema["knowledge_points"]["columns"]["owner_id"]["nullable"] is False
            assert schema["knowledge_points"]["columns"]["visibility"]["nullable"] is False
            assert schema["exams"]["columns"]["owner_id"]["nullable"] is False

            for table_name in ("question_banks", "questions", "knowledge_points", "exams"):
                assert any(
                    fk["constrained_columns"] == ["owner_id"]
                    and fk["referred_table"] == "users"
                    and fk["referred_columns"] == ["id"]
                    for fk in schema[table_name]["foreign_keys"]
                )

            bank_rows = {row["name"]: row for row in schema["question_banks"]["rows"]}
            kp_rows = {row["name"]: row for row in schema["knowledge_points"]["rows"]}

            assert bank_rows["Linked Bank"]["owner_id"] == SCHEMA_USER_B
            assert bank_rows["Fallback Bank"]["owner_id"] == SCHEMA_USER_A
            assert kp_rows["Linked KP"]["owner_id"] == SCHEMA_USER_B
            assert kp_rows["Fallback KP"]["owner_id"] == SCHEMA_USER_A
            assert schema["questions"]["rows"][0]["owner_id"] == SCHEMA_USER_B
            assert schema["exams"]["rows"][0]["owner_id"] == SCHEMA_USER_B
            assert bank_rows["Linked Bank"]["visibility"] == "private"
            assert bank_rows["Fallback Bank"]["visibility"] == "private"
            assert kp_rows["Linked KP"]["visibility"] == "private"
            assert kp_rows["Fallback KP"]["visibility"] == "private"

            await conn.run_sync(lambda sync_conn: _run_revision(sync_conn, module, "downgrade"))

            downgraded_columns = await conn.run_sync(
                lambda sync_conn: {
                    table_name: {column["name"] for column in inspect(sync_conn).get_columns(table_name, schema=schema_name)}
                    for table_name in ("question_banks", "questions", "knowledge_points", "exams")
                }
            )

            assert "owner_id" not in downgraded_columns["question_banks"]
            assert "visibility" not in downgraded_columns["question_banks"]
            assert "owner_id" not in downgraded_columns["questions"]
            assert "owner_id" not in downgraded_columns["knowledge_points"]
            assert "visibility" not in downgraded_columns["knowledge_points"]
            assert "owner_id" not in downgraded_columns["exams"]
    finally:
        async with engine.begin() as conn:
            await conn.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE')
        await engine.dispose()
