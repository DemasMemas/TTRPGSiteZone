"""Persist physical storeys (including basements); legacy characters remain at zero."""
from alembic import op
import sqlalchemy as sa

revision = 'c6a2d4e8f019'
down_revision = 'b3d8e1f4a6c2'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters') as batch:
        batch.add_column(sa.Column('floor_level', sa.Integer(), nullable=False, server_default='0'))


def downgrade():
    with op.batch_alter_table('location_characters') as batch:
        batch.drop_column('floor_level')
