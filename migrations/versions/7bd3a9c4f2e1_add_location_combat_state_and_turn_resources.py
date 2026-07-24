"""add location combat state and turn resources

Revision ID: 7bd3a9c4f2e1
Revises: 95e95ce809ed
Create Date: 2026-07-19 23:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '7bd3a9c4f2e1'
down_revision = '95e95ce809ed'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.add_column(sa.Column('initiative_bonus', sa.Integer(), nullable=False, server_default=sa.text('0')))
        batch_op.add_column(sa.Column('initiative_roll', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('initiative_total', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('action_points_max', sa.Integer(), nullable=False, server_default=sa.text('5')))
        batch_op.add_column(sa.Column('action_points_current', sa.Integer(), nullable=False, server_default=sa.text('5')))
        batch_op.add_column(sa.Column('free_actions_max', sa.Integer(), nullable=False, server_default=sa.text('1')))
        batch_op.add_column(sa.Column('free_actions_current', sa.Integer(), nullable=False, server_default=sa.text('1')))
        batch_op.add_column(sa.Column('movement_points_max', sa.Integer(), nullable=False, server_default=sa.text('6')))
        batch_op.add_column(sa.Column('movement_points_current', sa.Integer(), nullable=False, server_default=sa.text('6')))

    op.create_table(
        'location_combat_states',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('location_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default=sa.text("'idle'")),
        sa.Column('round_number', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('turn_index', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('turn_order', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column('current_location_character_id', sa.Integer(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['current_location_character_id'], ['location_characters.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['location_id'], ['locations.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('location_id'),
    )

    op.execute(sa.text(
        """
        UPDATE location_characters
        SET initiative_bonus = COALESCE(initiative_bonus, 0),
            initiative_roll = initiative_roll,
            initiative_total = initiative_total,
            action_points_max = COALESCE(action_points_max, 5),
            action_points_current = COALESCE(action_points_current, 5),
            free_actions_max = COALESCE(free_actions_max, 1),
            free_actions_current = COALESCE(free_actions_current, 1),
            movement_points_max = COALESCE(movement_points_max, 6),
            movement_points_current = COALESCE(movement_points_current, 6)
        """
    ))


def downgrade():
    op.drop_table('location_combat_states')

    with op.batch_alter_table('location_characters', schema=None) as batch_op:
        batch_op.drop_column('movement_points_current')
        batch_op.drop_column('movement_points_max')
        batch_op.drop_column('free_actions_current')
        batch_op.drop_column('free_actions_max')
        batch_op.drop_column('action_points_current')
        batch_op.drop_column('action_points_max')
        batch_op.drop_column('initiative_total')
        batch_op.drop_column('initiative_roll')
        batch_op.drop_column('initiative_bonus')
