"""add persisted lobby game time"""

from alembic import op
import sqlalchemy as sa


revision = "a1c2d3e4f5a6"
down_revision = "ff6a7b8c9d01"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("lobbies") as batch_op:
        batch_op.add_column(sa.Column("game_day", sa.Integer(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("game_time_minutes", sa.Integer(), nullable=False, server_default="480"))


def downgrade():
    with op.batch_alter_table("lobbies") as batch_op:
        batch_op.drop_column("game_time_minutes")
        batch_op.drop_column("game_day")
