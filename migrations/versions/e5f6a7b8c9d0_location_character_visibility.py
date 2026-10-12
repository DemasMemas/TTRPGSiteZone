"""Store GM visibility on placed characters."""

from alembic import op
import sqlalchemy as sa


revision = 'e5f6a7b8c9d0'
down_revision = 'e4f5a6b7c8d9'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters') as batch_op:
        batch_op.add_column(sa.Column('gm_hidden', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    with op.batch_alter_table('location_characters') as batch_op:
        batch_op.drop_column('gm_hidden')
