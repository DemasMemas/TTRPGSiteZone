"""add rapid fire round marker

Revision ID: c4b8216d9f10
Revises: 6593f286ad65
Create Date: 2026-07-24 20:53:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'c4b8216d9f10'
down_revision = '6593f286ad65'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.add_column(sa.Column('rapid_fire_round', sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.drop_column('rapid_fire_round')
