"""add combat movement modes

Revision ID: e8b2c4d6f901
Revises: d7a91e35bc42
Create Date: 2026-07-24 22:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'e8b2c4d6f901'
down_revision = 'd7a91e35bc42'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.add_column(sa.Column('movement_mode_this_turn', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column(
            'movement_distance_this_turn',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('0'),
        ))
        batch_op.add_column(sa.Column(
            'correction_distance_this_turn',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('0'),
        ))
        batch_op.add_column(sa.Column(
            'movement_blocked_until_round',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('0'),
        ))
        batch_op.add_column(sa.Column(
            'strenuous_movement_blocked_until_round',
            sa.Integer(),
            nullable=False,
            server_default=sa.text('0'),
        ))


def downgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.drop_column('strenuous_movement_blocked_until_round')
        batch_op.drop_column('movement_blocked_until_round')
        batch_op.drop_column('correction_distance_this_turn')
        batch_op.drop_column('movement_distance_this_turn')
        batch_op.drop_column('movement_mode_this_turn')
