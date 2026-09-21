import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool, text
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import settings
from app.models import Base

# Import all models so Alembic can detect them
from app.chaoxing.models import ExternalExam, ExternalCandidate, ExternalItem, ExternalAudit  # noqa: F401
from app.grading.models import GradingTask  # noqa: F401
from app.auth.models import User  # noqa: F401
from app.notifications.models import Notification  # noqa: F401
from app.papers.models import Paper, PaperImportSession, PaperQuestion  # noqa: F401
from app.questions.models import KnowledgePoint, Question, QuestionBank, Tag  # noqa: F401
from app.exams.models import Exam  # noqa: F401
from app.job_models.models import JobModel, SkillCourseMapping, JobModelGraphLayout  # noqa: F401
from app.rbac.models import Organization, Role, Permission  # noqa: F401

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def widen_alembic_version_column(connection) -> None:
    """Allow longer revision ids on older databases with varchar(32)."""
    if connection.dialect.name != "postgresql":
        return

    connection.execute(
        text("ALTER TABLE IF EXISTS alembic_version ALTER COLUMN version_num TYPE VARCHAR(128)")
    )


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    widen_alembic_version_column(connection)
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.begin() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
