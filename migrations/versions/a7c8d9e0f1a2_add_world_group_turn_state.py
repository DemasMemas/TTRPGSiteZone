"""add simultaneous world group turn state"""

from alembic import op
import sqlalchemy as sa


revision = "a7c8d9e0f1a2"
down_revision = "f6b7c8d9e0f1"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "world_groups",
        sa.Column("turn_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column("world_groups", sa.Column("turn_submitted_day", sa.Integer()))
    op.add_column("world_groups", sa.Column("turn_submitted_minutes", sa.Integer()))
    op.alter_column("world_groups", "turn_active", server_default=None)


def downgrade():
    op.drop_column("world_groups", "turn_submitted_minutes")
    op.drop_column("world_groups", "turn_submitted_day")
    op.drop_column("world_groups", "turn_active")
