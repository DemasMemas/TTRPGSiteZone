"""add character interaction requests"""

from alembic import op
import sqlalchemy as sa


revision = "b8d9e0f1a2b3"
down_revision = "a7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "character_interaction_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("location_id", sa.Integer(), nullable=False),
        sa.Column("actor_location_character_id", sa.Integer(), nullable=False),
        sa.Column("target_location_character_id", sa.Integer(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=False),
        sa.Column("target_user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime()),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["actor_location_character_id"],
            ["location_characters.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_location_character_id"],
            ["location_characters.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"]),
    )
    op.create_index(
        "ix_character_interaction_requests_location_id",
        "character_interaction_requests",
        ["location_id"],
    )
    op.create_index(
        "ix_character_interaction_requests_status",
        "character_interaction_requests",
        ["status"],
    )


def downgrade():
    op.drop_index(
        "ix_character_interaction_requests_status",
        table_name="character_interaction_requests",
    )
    op.drop_index(
        "ix_character_interaction_requests_location_id",
        table_name="character_interaction_requests",
    )
    op.drop_table("character_interaction_requests")
