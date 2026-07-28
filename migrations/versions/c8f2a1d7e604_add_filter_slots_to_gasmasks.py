"""Add filter slots to global gas masks and gas mask helmets."""

from alembic import op
import sqlalchemy as sa


revision = "c8f2a1d7e604"
down_revision = "b7e1c2d4f906"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("category", sa.String),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.category, templates.c.attributes)
        .where(templates.c.category.in_(["gas_mask", "helmet"]))
    ).mappings().all()
    for row in rows:
        attributes = dict(row["attributes"] or {})
        requires_filter = row["category"] == "gas_mask" or attributes.get("requires_filter") is True
        if not requires_filter:
            continue
        slots = list(attributes.get("slots") or [])
        if not any(isinstance(slot, dict) and slot.get("type") == "filter" for slot in slots):
            slots.append({"type": "filter", "label": "Фильтр", "maxItems": 1})
            attributes["slots"] = slots
            bind.execute(
                templates.update()
                .where(templates.c.id == row["id"])
                .values(attributes=attributes)
            )


def downgrade():
    pass
