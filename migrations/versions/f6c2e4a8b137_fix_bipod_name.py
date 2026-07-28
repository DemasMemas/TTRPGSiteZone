"""Normalize the bipod template name after the initial data migration."""

from alembic import op
import sqlalchemy as sa


revision = "f6c2e4a8b137"
down_revision = "f5b1d3e7a926"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    table = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(table.c.id, table.c.attributes).where(table.c.category == "weapon_module")
    ).mappings().all()
    for row in rows:
        if (row["attributes"] or {}).get("bipod"):
            bind.execute(
                table.update().where(table.c.id == row["id"]).values(name="\u0421\u043e\u0448\u043a\u0438")
            )


def downgrade():
    pass
