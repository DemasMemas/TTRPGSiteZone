"""add drawn weapon state

Revision ID: c2f6a8b0d345
Revises: b1e5f7a9c234
Create Date: 2026-07-28 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'c2f6a8b0d345'
down_revision = 'b1e5f7a9c234'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.add_column(sa.Column('drawn_weapon_index', sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.drop_column('drawn_weapon_index')
