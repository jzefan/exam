"""Persistence models for the grading trust core."""

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, ForeignKeyConstraint, Index, Integer, JSON, String, Text, UniqueConstraint, Uuid, event, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship, validates

from app.models import BaseModel

json_field = JSON().with_variant(JSONB, "postgresql")


class ProviderConfig(BaseModel):
    __tablename__ = "grading_provider_configs"

    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    provider_type: Mapped[str] = mapped_column(String(50), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    credential_env: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    models: Mapped[list["ModelConfig"]] = relationship("ModelConfig", back_populates="provider")


class ModelConfig(BaseModel):
    __tablename__ = "grading_model_configs"

    key: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    model_name: Mapped[str] = mapped_column(String(150), nullable=False)
    provider_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_provider_configs.id", ondelete="CASCADE"), nullable=False
    )
    temperature: Mapped[float] = mapped_column(Float, default=0.1, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    provider: Mapped["ProviderConfig"] = relationship("ProviderConfig", back_populates="models")


class RoleBinding(BaseModel):
    __tablename__ = "grading_role_bindings"

    version: Mapped[int] = mapped_column(Integer, nullable=False)
    grader_model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_model_configs.id", ondelete="CASCADE"), nullable=False
    )
    reviewer_model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_model_configs.id", ondelete="CASCADE"), nullable=False
    )
    arbiter_model_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("grading_model_configs.id", ondelete="CASCADE"), nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (UniqueConstraint("version", name="uq_grading_role_bindings_version"),)

    grader_model: Mapped["ModelConfig"] = relationship("ModelConfig", foreign_keys=[grader_model_id])
    reviewer_model: Mapped["ModelConfig"] = relationship("ModelConfig", foreign_keys=[reviewer_model_id])
    arbiter_model: Mapped["ModelConfig"] = relationship("ModelConfig", foreign_keys=[arbiter_model_id])


class GradingTask(BaseModel):
    __tablename__ = "grading_tasks"
    __table_args__ = (
        Index("ix_grading_tasks_source_business_id", "source_business_id"),
        Index("ix_grading_tasks_source_business_id_status", "source_business_id", "status"),
        ForeignKeyConstraint(
            ["id", "latest_primary_snapshot_id"],
            ["grading_result_snapshots.task_id", "grading_result_snapshots.id"],
            name="fk_grading_tasks_latest_primary_snapshot_owner",
            use_alter=True,
        ),
        ForeignKeyConstraint(
            ["id", "latest_review_snapshot_id"],
            ["grading_result_snapshots.task_id", "grading_result_snapshots.id"],
            name="fk_grading_tasks_latest_review_snapshot_owner",
            use_alter=True,
        ),
        ForeignKeyConstraint(
            ["id", "latest_arbitration_snapshot_id"],
            ["grading_result_snapshots.task_id", "grading_result_snapshots.id"],
            name="fk_grading_tasks_latest_arbitration_snapshot_owner",
            use_alter=True,
        ),
        ForeignKeyConstraint(
            ["id", "latest_final_snapshot_id"],
            ["grading_result_snapshots.task_id", "grading_result_snapshots.id"],
            name="fk_grading_tasks_latest_final_snapshot_owner",
            use_alter=True,
        ),
        ForeignKeyConstraint(
            ["id", "latest_manual_snapshot_id"],
            ["grading_result_snapshots.task_id", "grading_result_snapshots.id"],
            name="fk_grading_tasks_latest_manual_snapshot_owner",
            use_alter=True,
        ),
    )

    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    source_business_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="pending", nullable=False)
    question_type: Mapped[str] = mapped_column(String(50), nullable=False)
    question_content: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str | None] = mapped_column(String(100), nullable=True)
    language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    max_score: Mapped[int] = mapped_column(Integer, nullable=False)
    knowledge_tags: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    fatal_rule_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    student_answer_raw: Mapped[str] = mapped_column(Text, nullable=False)
    student_answer_structured: Mapped[dict | None] = mapped_column(json_field, nullable=True)
    ocr_raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ocr_repaired_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    attachment_refs: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    standard_answers: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    rubric_definition: Mapped[dict] = mapped_column(json_field, default=dict, nullable=False)
    scoring_points: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    dimension_weights: Mapped[dict] = mapped_column(json_field, default=dict, nullable=False)
    deduction_rules: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    fatal_error_rules: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    prompt_template_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role_binding_version: Mapped[int] = mapped_column(
        Integer, ForeignKey("grading_role_bindings.version", ondelete="RESTRICT"), nullable=False
    )
    programming_language: Mapped[str | None] = mapped_column(String(50), nullable=True)
    execution_env: Mapped[dict | None] = mapped_column(json_field, nullable=True)
    test_summary: Mapped[dict | None] = mapped_column(json_field, nullable=True)
    compile_result: Mapped[dict | None] = mapped_column(json_field, nullable=True)
    runtime_result: Mapped[dict | None] = mapped_column(json_field, nullable=True)
    runtime_logs: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    resource_limit_summary: Mapped[dict | None] = mapped_column(json_field, nullable=True)
    latest_primary_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey(
            "grading_result_snapshots.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_grading_tasks_latest_primary_snapshot_id",
        ),
        nullable=True,
    )
    latest_review_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey(
            "grading_result_snapshots.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_grading_tasks_latest_review_snapshot_id",
        ),
        nullable=True,
    )
    latest_arbitration_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey(
            "grading_result_snapshots.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_grading_tasks_latest_arbitration_snapshot_id",
        ),
        nullable=True,
    )
    latest_final_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey(
            "grading_result_snapshots.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_grading_tasks_latest_final_snapshot_id",
        ),
        nullable=True,
    )
    latest_manual_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey(
            "grading_result_snapshots.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_grading_tasks_latest_manual_snapshot_id",
        ),
        nullable=True,
    )

    snapshots: Mapped[list["GradingResultSnapshot"]] = relationship(
        "GradingResultSnapshot",
        back_populates="task",
        cascade="all, delete-orphan",
        foreign_keys="GradingResultSnapshot.task_id",
    )
    audit_events: Mapped[list["GradingAuditEvent"]] = relationship(
        "GradingAuditEvent", back_populates="task", cascade="all, delete-orphan"
    )
    latest_primary_snapshot: Mapped["GradingResultSnapshot | None"] = relationship(
        "GradingResultSnapshot", foreign_keys=[latest_primary_snapshot_id], post_update=True
    )
    latest_review_snapshot: Mapped["GradingResultSnapshot | None"] = relationship(
        "GradingResultSnapshot", foreign_keys=[latest_review_snapshot_id], post_update=True
    )
    latest_arbitration_snapshot: Mapped["GradingResultSnapshot | None"] = relationship(
        "GradingResultSnapshot", foreign_keys=[latest_arbitration_snapshot_id], post_update=True
    )
    latest_final_snapshot: Mapped["GradingResultSnapshot | None"] = relationship(
        "GradingResultSnapshot", foreign_keys=[latest_final_snapshot_id], post_update=True
    )
    latest_manual_snapshot: Mapped["GradingResultSnapshot | None"] = relationship(
        "GradingResultSnapshot", foreign_keys=[latest_manual_snapshot_id], post_update=True
    )

    @validates(
        "latest_primary_snapshot",
        "latest_review_snapshot",
        "latest_arbitration_snapshot",
        "latest_final_snapshot",
        "latest_manual_snapshot",
    )
    def _validate_latest_snapshot_relationship(
        self, key: str, snapshot: "GradingResultSnapshot | None"
    ) -> "GradingResultSnapshot | None":
        if snapshot is None:
            return None

        if snapshot.task is not None and snapshot.task is not self:
            raise ValueError(f"{key} must reference a snapshot belonging to the same grading task")

        if self.id is not None:
            if snapshot.task_id is not None and snapshot.task_id != self.id:
                raise ValueError(f"{key} must reference a snapshot belonging to the same grading task")
            if snapshot.task is not None and snapshot.task.id is not None and snapshot.task.id != self.id:
                raise ValueError(f"{key} must reference a snapshot belonging to the same grading task")

        return snapshot


class GradingResultSnapshot(BaseModel):
    __tablename__ = "grading_result_snapshots"
    __table_args__ = (
        UniqueConstraint("task_id", "id", name="uq_grading_result_snapshots_task_id_id"),
    )

    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("grading_tasks.id", ondelete="CASCADE"), nullable=False)
    snapshot_type: Mapped[str] = mapped_column(String(50), nullable=False)
    score_total: Mapped[float] = mapped_column(Float, nullable=False)
    dimension_scores: Mapped[dict] = mapped_column(json_field, default=dict, nullable=False)
    deduction_reasons: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    strengths: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    improvement_suggestions: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    evidence_summary: Mapped[dict] = mapped_column(json_field, default=dict, nullable=False)
    risk_flags: Mapped[list] = mapped_column(json_field, default=list, nullable=False)
    provider_config_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("grading_provider_configs.id", ondelete="SET NULL"), nullable=True
    )
    model_config_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("grading_model_configs.id", ondelete="SET NULL"), nullable=True
    )
    prompt_template_version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role_binding_version: Mapped[int] = mapped_column(
        Integer, ForeignKey("grading_role_bindings.version", ondelete="RESTRICT"), nullable=False
    )
    created_by: Mapped[str] = mapped_column(String(100), nullable=False)

    task: Mapped["GradingTask"] = relationship(
        "GradingTask", back_populates="snapshots", foreign_keys=[task_id]
    )
    provider_config: Mapped["ProviderConfig | None"] = relationship("ProviderConfig")
    model_config: Mapped["ModelConfig | None"] = relationship("ModelConfig")


class GradingAuditEvent(BaseModel):
    __tablename__ = "grading_audit_events"

    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("grading_tasks.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    event_payload: Mapped[dict] = mapped_column(json_field, default=dict, nullable=False)
    operator_type: Mapped[str] = mapped_column(String(50), nullable=False)
    operator_id: Mapped[str] = mapped_column(String(100), nullable=False)

    task: Mapped["GradingTask"] = relationship("GradingTask", back_populates="audit_events")


LATEST_SNAPSHOT_ID_ATTRS = (
    "latest_primary_snapshot_id",
    "latest_review_snapshot_id",
    "latest_arbitration_snapshot_id",
    "latest_final_snapshot_id",
    "latest_manual_snapshot_id",
)


def _validate_latest_snapshot_ownership(session: Session, task: GradingTask) -> None:
    pending_snapshot_owners = {
        snapshot.id: snapshot.task_id
        for snapshot in session.new.union(session.identity_map.values())
        if isinstance(snapshot, GradingResultSnapshot) and snapshot.id is not None
    }

    for attr_name in LATEST_SNAPSHOT_ID_ATTRS:
        snapshot_id = getattr(task, attr_name)
        if snapshot_id is None:
            continue

        owner_task_id = pending_snapshot_owners.get(snapshot_id)
        if owner_task_id is None:
            owner_task_id = session.execute(
                select(GradingResultSnapshot.task_id).where(GradingResultSnapshot.id == snapshot_id)
            ).scalar_one_or_none()

        if owner_task_id is not None and owner_task_id != task.id:
            raise ValueError(f"{attr_name} must reference a snapshot belonging to the same grading task")


@event.listens_for(Session, "before_flush")
def _validate_grading_task_snapshot_ownership(session: Session, flush_context, instances) -> None:
    for obj in session.new.union(session.dirty):
        if isinstance(obj, GradingTask) and obj.id is not None:
            _validate_latest_snapshot_ownership(session, obj)
