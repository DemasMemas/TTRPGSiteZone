"""Add per-location team markers."""
from alembic import op
import sqlalchemy as sa

revision = "d9e3f4a5b607"
down_revision = "b8d9e0f1a2b3"
branch_labels = None
depends_on = None

def upgrade():
    with op.batch_alter_table("location_characters") as batch_op:
        batch_op.add_column(sa.Column("team_name", sa.String(length=80), nullable=True))
        batch_op.add_column(sa.Column("team_color", sa.String(length=16), nullable=True))

def downgrade():
    with op.batch_alter_table("location_characters") as batch_op:
        batch_op.drop_column("team_color")
        batch_op.drop_column("team_name")
