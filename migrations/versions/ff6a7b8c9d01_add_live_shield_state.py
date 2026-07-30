"""add live shield state"""

from alembic import op
import sqlalchemy as sa


revision = "ff6a7b8c9d01"
down_revision = "fe5f6a7b8c90"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("location_characters") as batch_op:
        batch_op.add_column(
            sa.Column(
                "grapple_live_shield",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade():
    with op.batch_alter_table("location_characters") as batch_op:
        batch_op.drop_column("grapple_live_shield")
