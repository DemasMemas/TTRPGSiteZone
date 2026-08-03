"""add world groups and travel events"""

from alembic import op
import sqlalchemy as sa


revision = "d4f5a6b7c8d9"
down_revision = "c3e4f5a6b7c8"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "world_groups",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lobby_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("tile_x", sa.Integer(), nullable=False),
        sa.Column("tile_y", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["lobby_id"], ["lobbies.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_world_groups_lobby_id", "world_groups", ["lobby_id"])
    op.create_table(
        "world_travel_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lobby_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("from_tile_x", sa.Integer(), nullable=False),
        sa.Column("from_tile_y", sa.Integer(), nullable=False),
        sa.Column("to_tile_x", sa.Integer(), nullable=False),
        sa.Column("to_tile_y", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["group_id"], ["world_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lobby_id"], ["lobbies.id"]),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_world_travel_events_group_id", "world_travel_events", ["group_id"])
    op.create_index("ix_world_travel_events_lobby_id", "world_travel_events", ["lobby_id"])
    op.create_index("ix_world_travel_events_status", "world_travel_events", ["status"])


def downgrade():
    op.drop_index("ix_world_travel_events_status", table_name="world_travel_events")
    op.drop_index("ix_world_travel_events_lobby_id", table_name="world_travel_events")
    op.drop_index("ix_world_travel_events_group_id", table_name="world_travel_events")
    op.drop_table("world_travel_events")
    op.drop_index("ix_world_groups_lobby_id", table_name="world_groups")
    op.drop_table("world_groups")
