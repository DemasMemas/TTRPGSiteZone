"""Store the optional visual variant of the prone posture."""

from alembic import op
import sqlalchemy as sa


revision = 'b3d8e1f4a6c2'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('location_characters') as batch_op:
        batch_op.add_column(sa.Column(
            'prone_on_back', sa.Boolean(), nullable=False, server_default=sa.false(),
        ))


def downgrade():
    with op.batch_alter_table('location_characters') as batch_op:
        batch_op.drop_column('prone_on_back')
