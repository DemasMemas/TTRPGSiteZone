"""add placed world events"""

from alembic import op
import sqlalchemy as sa


revision = "f6b7c8d9e0f1"
down_revision = "e5a6b7c8d9e0"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "world_map_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lobby_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("tile_x", sa.Integer(), nullable=False),
        sa.Column("tile_y", sa.Integer(), nullable=False),
        sa.Column("repeatable", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["lobby_id"], ["lobbies.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_world_map_events_lobby_id", "world_map_events", ["lobby_id"])
    op.add_column("world_travel_events", sa.Column("world_map_event_id", sa.Integer()))
    op.create_foreign_key(
        "fk_world_travel_events_world_map_event_id",
        "world_travel_events",
        "world_map_events",
        ["world_map_event_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_world_travel_events_world_map_event_id",
        "world_travel_events",
        ["world_map_event_id"],
    )


def downgrade():
    op.drop_index("ix_world_travel_events_world_map_event_id", table_name="world_travel_events")
    op.drop_constraint(
        "fk_world_travel_events_world_map_event_id",
        "world_travel_events",
        type_="foreignkey",
    )
    op.drop_column("world_travel_events", "world_map_event_id")
    op.drop_index("ix_world_map_events_lobby_id", table_name="world_map_events")
    op.drop_table("world_map_events")
