"""add combat reaction state"""

from alembic import op
import sqlalchemy as sa


revision = "a2b3c4d5e6f7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("location_combat_states") as batch_op:
        batch_op.add_column(sa.Column("reaction_pending_location_character_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("reaction_return_location_character_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_location_combat_states_reaction_pending_character",
            "location_characters",
            ["reaction_pending_location_character_id"],
            ["id"],
        )
        batch_op.create_foreign_key(
            "fk_location_combat_states_reaction_return_character",
            "location_characters",
            ["reaction_return_location_character_id"],
            ["id"],
        )


def downgrade():
    with op.batch_alter_table("location_combat_states") as batch_op:
        batch_op.drop_constraint("fk_location_combat_states_reaction_return_character", type_="foreignkey")
        batch_op.drop_constraint("fk_location_combat_states_reaction_pending_character", type_="foreignkey")
        batch_op.drop_column("reaction_return_location_character_id")
        batch_op.drop_column("reaction_pending_location_character_id")
