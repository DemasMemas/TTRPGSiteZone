"""Track one combat-facing change per round."""
from alembic import op
import sqlalchemy as sa

revision = "e1f2a3b4c5d6"
down_revision = "d9e3f4a5b607"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("location_characters") as batch_op:
        batch_op.add_column(sa.Column("facing_changed_round", sa.Integer(), nullable=True))


def downgrade():
    with op.batch_alter_table("location_characters") as batch_op:
        batch_op.drop_column("facing_changed_round")
