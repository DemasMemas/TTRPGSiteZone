"""add character edit permissions

Revision ID: d2a97b4c6e01
Revises: c1f86a2b5d34
"""

from alembic import op
import sqlalchemy as sa


revision = "d2a97b4c6e01"
down_revision = "c1f86a2b5d34"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("lobby_characters") as batch_op:
        batch_op.add_column(sa.Column(
            "editable_to",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ))


def downgrade():
    with op.batch_alter_table("lobby_characters") as batch_op:
        batch_op.drop_column("editable_to")
