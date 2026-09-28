"""Add optimistic concurrency control for character writes."""

from alembic import op
import sqlalchemy as sa

revision = 'a8b9c0d1e2f3'
down_revision = 'f7a8b9c0d1e2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('lobby_characters', sa.Column('revision', sa.Integer(), nullable=False, server_default='1'))


def downgrade():
    op.drop_column('lobby_characters', 'revision')
