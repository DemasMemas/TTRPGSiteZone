"""add character participation in lobby time"""

from alembic import op
import sqlalchemy as sa


revision = "c3e4f5a6b7c8"
down_revision = "b2d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("lobby_characters") as batch_op:
        batch_op.add_column(
            sa.Column(
                "time_active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )


def downgrade():
    with op.batch_alter_table("lobby_characters") as batch_op:
        batch_op.drop_column("time_active")
