"""add combat aim state

Revision ID: d7a91e35bc42
Revises: c4b8216d9f10
Create Date: 2026-07-24 21:03:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'd7a91e35bc42'
down_revision = 'c4b8216d9f10'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.add_column(sa.Column('aimed_target_character_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('aimed_weapon_index', sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.drop_column('aimed_weapon_index')
        batch_op.drop_column('aimed_target_character_id')
