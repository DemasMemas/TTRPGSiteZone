"""remove full movement block after sprint

Revision ID: f9c3d5e7a012
Revises: e8b2c4d6f901
Create Date: 2026-07-24 22:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'f9c3d5e7a012'
down_revision = 'e8b2c4d6f901'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.drop_column('movement_blocked_until_round')


def downgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'movement_blocked_until_round',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('0'),
        ))
