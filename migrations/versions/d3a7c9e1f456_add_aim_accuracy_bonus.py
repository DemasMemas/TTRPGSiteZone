"""add cumulative aim accuracy bonus

Revision ID: d3a7c9e1f456
Revises: c2f6a8b0d345
Create Date: 2026-07-28 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'd3a7c9e1f456'
down_revision = 'c2f6a8b0d345'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('aim_accuracy_bonus', sa.Integer(), nullable=False, server_default='0')
        )


def downgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.drop_column('aim_accuracy_bonus')
