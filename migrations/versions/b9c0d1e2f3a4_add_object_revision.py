"""Protect container writes from concurrent changes."""
from alembic import op
import sqlalchemy as sa

revision = 'b9c0d1e2f3a4'
down_revision = 'a8b9c0d1e2f3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('location_objects', sa.Column('revision', sa.Integer(), nullable=False, server_default='1'))


def downgrade():
    op.drop_column('location_objects', 'revision')
