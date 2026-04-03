"""drop user role column

Revision ID: 280f461072d3
Revises: 5430b9d518c3
Create Date: 2026-04-03 13:32:04.992616
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '280f461072d3'
down_revision: Union[str, None] = '5430b9d518c3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('users', 'role')
    # Drop the enum type that is no longer used
    sa.Enum(name='userrole').drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    userrole = postgresql.ENUM('ADMIN', 'TEACHER', 'STUDENT', name='userrole', create_type=False)
    userrole.create(op.get_bind(), checkfirst=True)
    op.add_column('users', sa.Column('role', userrole, server_default='STUDENT', nullable=False))
