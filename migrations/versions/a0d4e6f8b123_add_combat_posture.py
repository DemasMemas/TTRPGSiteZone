"""add combat posture

Revision ID: a0d4e6f8b123
Revises: f9c3d5e7a012
Create Date: 2026-07-24 23:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'a0d4e6f8b123'
down_revision = 'f9c3d5e7a012'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            'posture',
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'standing'"),
        ))


def downgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.drop_column('posture')
