"""add world group members"""

from alembic import op
import sqlalchemy as sa


revision = "e5a6b7c8d9e0"
down_revision = "d4f5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "world_groups",
        sa.Column(
            "member_character_ids",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'::json"),
        ),
    )


def downgrade():
    op.drop_column("world_groups", "member_character_ids")
