"""Fix the Excel date serial imported for Ushanaka charisma."""

from alembic import op
import sqlalchemy as sa


revision = "e4a7c1d9b502"
down_revision = "d9f3b2c7a801"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.name, templates.c.attributes)
        .where(templates.c.category == "helmet")
    ).mappings().all()
    for row in rows:
        if not str(row["name"] or "").strip().lower().endswith("ушанка"):
            continue
        attributes = dict(row["attributes"] or {})
        attributes["charisma_bonus"] = 1.5
        bind.execute(
            templates.update()
            .where(templates.c.id == row["id"])
            .values(attributes=attributes)
        )


def downgrade():
    pass
