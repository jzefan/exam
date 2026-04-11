"""add_classes_and_student_class_link

Revision ID: add_classes
Revises: add_phone_cols
Create Date: 2026-04-07 23:55:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_classes'
down_revision: Union[str, None] = 'add_phone_cols'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create classes table
    op.create_table(
        'classes',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('org_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Add class_id to users
    op.add_column('users', sa.Column('class_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('users_class_id_fkey', 'users', 'classes', ['class_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    op.drop_constraint('users_class_id_fkey', 'users', type_='foreignkey')
    op.drop_column('users', 'class_id')
    op.drop_table('classes')
