"""add melee combat state"""

from alembic import op
import sqlalchemy as sa


revision = "fe5f6a7b8c90"
down_revision = "fd4e5f6a7b89"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("location_characters") as batch_op:
        batch_op.add_column(sa.Column("facing_x", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("facing_y", sa.Integer(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("melee_swing_round", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("melee_block_round", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("melee_block_effectiveness", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("grapple_target_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("grappled_by_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("grapple_strengthened", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column("grapple_choke_rounds", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    with op.batch_alter_table("location_characters") as batch_op:
        batch_op.drop_column("grapple_choke_rounds")
        batch_op.drop_column("grapple_strengthened")
        batch_op.drop_column("grappled_by_id")
        batch_op.drop_column("grapple_target_id")
        batch_op.drop_column("melee_block_effectiveness")
        batch_op.drop_column("melee_block_round")
        batch_op.drop_column("melee_swing_round")
        batch_op.drop_column("facing_y")
        batch_op.drop_column("facing_x")
