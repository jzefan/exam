"""manual_add_phone_and_student_id

Revision ID: add_phone_cols
Revises: f3a9c1d2e8b7
Create Date: 2026-04-07 23:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_phone_cols'
down_revision: Union[str, None] = 'f3a9c1d2e8b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add columns
    op.add_column('users', sa.Column('phone', sa.String(length=20), nullable=True))
    op.add_column('users', sa.Column('student_id', sa.String(length=50), nullable=True))
    
    # Add index
    op.create_index(
        'ix_users_phone_active', 
        'users', 
        ['phone'], 
        unique=True, 
        postgresql_where=sa.text("deleted_at IS NULL AND phone IS NOT NULL")
    )


def downgrade() -> None:
    # Remove index
    op.drop_index('ix_users_phone_active', table_name='users')
    
    # Remove columns
    op.drop_column('users', 'student_id')
    op.drop_column('users', 'phone')
