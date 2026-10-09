"""Add per-location lighting settings."""

from alembic import op
import sqlalchemy as sa


revision = 'e3f4a5b6c7d8'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('locations') as batch_op:
        batch_op.add_column(sa.Column('lighting', sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade():
    with op.batch_alter_table('locations') as batch_op:
        batch_op.drop_column('lighting')
