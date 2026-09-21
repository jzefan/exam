"""Add local, versioned Chaoxing grading records and fractional task maxima."""

from alembic import op
import sqlalchemy as sa

revision = "20260920_chaoxing_grading"
down_revision = "20260920_add_kp_sort_order"
branch_labels = None
depends_on = None


def common():
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    ]


def upgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "chaoxing_grading_exams" not in existing:
        op.create_table(
            "chaoxing_grading_exams",
            *common(),
            sa.Column("owner_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("account_key", sa.String(64), nullable=False),
            sa.Column("course_key", sa.String(255), nullable=False),
            sa.Column("source_exam_id", sa.String(128), nullable=False),
            sa.Column("course_title", sa.String(300), nullable=False),
            sa.Column("title", sa.String(300), nullable=False),
            sa.Column("expected_submitted", sa.Integer()),
            sa.UniqueConstraint("owner_id", "account_key", "course_key", "source_exam_id", name="uq_cx_exam_source"),
        )
        op.create_index("ix_chaoxing_grading_exams_owner_id", "chaoxing_grading_exams", ["owner_id"])
    if "chaoxing_grading_candidates" not in existing:
        op.create_table(
            "chaoxing_grading_candidates",
            *common(),
            sa.Column("exam_id", sa.Uuid(), sa.ForeignKey("chaoxing_grading_exams.id"), nullable=False),
            sa.Column("source_candidate_id", sa.String(128), nullable=False),
            sa.Column("name", sa.String(200), nullable=False),
            sa.Column("student_no", sa.String(100), nullable=False),
            sa.Column("source_score", sa.Float()),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("content_hash", sa.String(64), nullable=False),
            sa.Column("declared_max_score", sa.Float()),
            sa.Column("completeness_confirmed", sa.Boolean(), nullable=False),
            sa.UniqueConstraint("exam_id", "source_candidate_id", name="uq_cx_candidate_source"),
        )
        op.create_index("ix_chaoxing_grading_candidates_exam_id", "chaoxing_grading_candidates", ["exam_id"])
    if "chaoxing_grading_items" not in existing:
        op.create_table(
            "chaoxing_grading_items",
            *common(),
            sa.Column("candidate_id", sa.Uuid(), sa.ForeignKey("chaoxing_grading_candidates.id"), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False),
            sa.Column("question_id", sa.String(128), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("question_type", sa.String(100), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("student_answer", sa.Text(), nullable=False),
            sa.Column("reference_answer", sa.Text(), nullable=False),
            sa.Column("max_score", sa.Float()),
            sa.Column("objective", sa.Boolean(), nullable=False),
            sa.Column("requires_manual_review", sa.Boolean(), nullable=False),
            sa.Column("source_score", sa.Float()),
            sa.Column("task_id", sa.Uuid(), sa.ForeignKey("grading_tasks.id"), unique=True),
            sa.Column("status", sa.String(30), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("ai_score", sa.Float()),
            sa.Column("confirmed_score", sa.Float()),
            sa.Column("confirmed_at", sa.DateTime(timezone=True)),
            sa.Column("confirmed_by", sa.Uuid(), sa.ForeignKey("users.id")),
            sa.Column("comment", sa.Text(), nullable=False),
            sa.Column("error", sa.String(300), nullable=False),
            sa.UniqueConstraint("candidate_id", "revision", "question_id", name="uq_cx_item_version"),
        )
        op.create_index("ix_chaoxing_grading_items_candidate_id", "chaoxing_grading_items", ["candidate_id"])
        op.create_index("ix_chaoxing_grading_items_status", "chaoxing_grading_items", ["status"])
    if "chaoxing_grading_audits" not in existing:
        op.create_table(
            "chaoxing_grading_audits",
            *common(),
            sa.Column("candidate_id", sa.Uuid(), sa.ForeignKey("chaoxing_grading_candidates.id"), nullable=False),
            sa.Column("item_id", sa.Uuid(), sa.ForeignKey("chaoxing_grading_items.id")),
            sa.Column("actor_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("action", sa.String(50), nullable=False),
            sa.Column("details", sa.JSON(), nullable=False),
        )
        op.create_index("ix_chaoxing_grading_audits_candidate_id", "chaoxing_grading_audits", ["candidate_id"])
    if op.get_bind().dialect.name == "postgresql":
        op.alter_column(
            "grading_tasks", "max_score", existing_type=sa.Integer(), type_=sa.Float(), existing_nullable=False
        )
    else:
        with op.batch_alter_table("grading_tasks") as batch:
            batch.alter_column("max_score", existing_type=sa.Integer(), type_=sa.Float(), existing_nullable=False)


def downgrade():
    for name in ("audits", "items", "candidates", "exams"):
        op.drop_table("chaoxing_grading_" + name)
    # Preserve fractional maxima in existing grading records on rollback.
