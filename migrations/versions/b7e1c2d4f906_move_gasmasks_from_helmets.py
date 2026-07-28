"""Move gas mask templates imported into the helmet category."""

from alembic import op
import sqlalchemy as sa


revision = "b7e1c2d4f906"
down_revision = "a5dc0e7f9b34"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("subcategory", sa.String),
    )

    rows = bind.execute(
        sa.select(templates.c.id, templates.c.name)
        .where(templates.c.category == "helmet")
    ).mappings().all()
    for row in rows:
        name = str(row["name"] or "").strip().lower()
        if name.startswith(("противогаз", "респиратор")):
            bind.execute(
                templates.update()
                .where(templates.c.id == row["id"])
                .values(category="gas_mask", subcategory="Противогазы")
            )


def downgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("subcategory", sa.String),
    )
    bind.execute(
        templates.update()
        .where(templates.c.category == "gas_mask")
        .where(templates.c.subcategory == "Противогазы")
        .values(category="helmet")
    )
