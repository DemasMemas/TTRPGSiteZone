"""add character cover state

Revision ID: c1f86a2b5d34
Revises: b0e75f1a4c23
Create Date: 2026-07-28 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'c1f86a2b5d34'
down_revision = 'b0e75f1a4c23'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters') as batch_op:
        batch_op.add_column(sa.Column('cover_object_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('weapon_braced', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('braced_weapon_index', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_location_character_cover_object',
            'location_objects',
            ['cover_object_id'],
            ['id'],
        )


def downgrade():
    with op.batch_alter_table('location_characters') as batch_op:
        batch_op.drop_constraint('fk_location_character_cover_object', type_='foreignkey')
        batch_op.drop_column('braced_weapon_index')
        batch_op.drop_column('weapon_braced')
        batch_op.drop_column('cover_object_id')
