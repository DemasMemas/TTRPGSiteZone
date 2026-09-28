"""Persist the parameters and completion of deferred combat actions."""
from alembic import op
import sqlalchemy as sa

revision = 'c0d1e2f3a4b5'
down_revision = 'b9c0d1e2f3a4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'deferred_combat_actions',
        sa.Column('id', sa.String(120), primary_key=True),
        sa.Column('location_character_id', sa.Integer(), sa.ForeignKey('location_characters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('label', sa.String(200), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('remaining_action_points', sa.Integer(), nullable=False),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='1'),
    )
    op.create_index('ix_deferred_combat_actions_location_character_id', 'deferred_combat_actions', ['location_character_id'])


def downgrade():
    op.drop_table('deferred_combat_actions')
