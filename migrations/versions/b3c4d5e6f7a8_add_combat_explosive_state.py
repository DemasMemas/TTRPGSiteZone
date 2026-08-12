"""add persistent explosive and area state"""

from alembic import op
import sqlalchemy as sa


revision = "b3c4d5e6f7a8"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("location_combat_states") as batch_op:
        batch_op.add_column(
            sa.Column("pending_explosives", sa.JSON(), nullable=False, server_default="[]")
        )
        batch_op.add_column(
            sa.Column("area_effects", sa.JSON(), nullable=False, server_default="[]")
        )


def downgrade():
    with op.batch_alter_table("location_combat_states") as batch_op:
        batch_op.drop_column("area_effects")
        batch_op.drop_column("pending_explosives")
