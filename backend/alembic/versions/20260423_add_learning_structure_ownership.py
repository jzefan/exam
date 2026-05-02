"""add learning structure ownership

Revision ID: 20260423_learning_owner
Revises: 20260421_add_exam_allow_retake
Create Date: 2026-04-23

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260423_learning_owner"
down_revision: Union[str, None] = "20260421_add_exam_allow_retake"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("major", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_major_owner_id_users", "major", "users", ["owner_id"], ["id"])

    op.add_column("direction", sa.Column("owner_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_direction_owner_id_users", "direction", "users", ["owner_id"], ["id"])

    connection = op.get_bind()
    metadata = sa.MetaData()
    major = sa.Table(
        "major",
        metadata,
        sa.Column("id", sa.Uuid()),
        sa.Column("owner_id", sa.Uuid()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    direction = sa.Table(
        "direction",
        metadata,
        sa.Column("id", sa.Uuid()),
        sa.Column("major_id", sa.Uuid()),
        sa.Column("owner_id", sa.Uuid()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )
    knowledge_points = sa.Table(
        "knowledge_points",
        metadata,
        sa.Column("id", sa.Uuid()),
        sa.Column("direction_id", sa.Uuid()),
        sa.Column("owner_id", sa.Uuid()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
    )

    direction_owner_rows = connection.execute(
        sa.select(
            knowledge_points.c.direction_id.label("direction_id"),
            sa.func.max(sa.cast(knowledge_points.c.owner_id, sa.Text())).label("owner_id"),
        )
        .where(
            knowledge_points.c.direction_id.is_not(None),
            knowledge_points.c.deleted_at.is_(None),
        )
        .group_by(knowledge_points.c.direction_id)
        .having(sa.func.count(sa.distinct(knowledge_points.c.owner_id)) == 1)
    ).all()

    for row in direction_owner_rows:
        connection.execute(
            sa.update(direction)
            .where(direction.c.id == row.direction_id)
            .values(owner_id=row.owner_id)
        )

    major_owner_rows = connection.execute(
        sa.select(
            direction.c.major_id.label("major_id"),
            sa.func.max(sa.cast(direction.c.owner_id, sa.Text())).label("owner_id"),
        )
        .where(
            direction.c.owner_id.is_not(None),
            direction.c.deleted_at.is_(None),
        )
        .group_by(direction.c.major_id)
        .having(sa.func.count(sa.distinct(direction.c.owner_id)) == 1)
    ).all()

    for row in major_owner_rows:
        connection.execute(
            sa.update(major)
            .where(
                major.c.id == row.major_id,
                major.c.deleted_at.is_(None),
            )
            .values(owner_id=row.owner_id)
        )


def downgrade() -> None:
    op.drop_constraint("fk_direction_owner_id_users", "direction", type_="foreignkey")
    op.drop_column("direction", "owner_id")

    op.drop_constraint("fk_major_owner_id_users", "major", type_="foreignkey")
    op.drop_column("major", "owner_id")
