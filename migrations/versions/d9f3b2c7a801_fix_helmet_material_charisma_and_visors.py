"""Normalize helmet materials, Ushanaka charisma and visor slots."""

from alembic import op
import sqlalchemy as sa


revision = "d9f3b2c7a801"
down_revision = "c8f2a1d7e604"
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
        sa.select(templates.c.id, templates.c.name, templates.c.category, templates.c.attributes)
        .where(templates.c.category.in_(["helmet", "gas_mask"]))
    ).mappings().all()
    definitions = {}
    for row in rows:
        attributes = dict(row["attributes"] or {})
        material = attributes.get("material") or attributes.get("armor_type")
        if material:
            attributes["material"] = material
        if str(row["name"] or "").strip().lower() == "ушанка":
            attributes["charisma_bonus"] = 1.5
        slots = list(attributes.get("slots") or [])
        if row["category"] == "gas_mask" or attributes.get("requires_filter") is True:
            if not any(isinstance(slot, dict) and slot.get("type") == "filter" for slot in slots):
                slots.append({"type": "filter", "label": "Фильтр", "maxItems": 1})
        if row["category"] == "helmet" and str(row["name"] or "").strip().lower().startswith("шлем"):
            if not any(isinstance(slot, dict) and slot.get("type") == "visor" for slot in slots):
                slots.append({"type": "visor", "label": "Забрало", "maxItems": 1})
        if slots:
            attributes["slots"] = slots
        definitions[int(row["id"])] = attributes
        bind.execute(templates.update().where(templates.c.id == row["id"]).values(attributes=attributes))

    characters = sa.table(
        "lobby_characters",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )
    for row in bind.execute(sa.select(characters.c.id, characters.c.data)).mappings():
        data = dict(row["data"] or {})
        equipment = dict(data.get("equipment") or {})
        changed = False
        for key in ("helmet", "gasMask"):
            item = equipment.get(key)
            if not isinstance(item, dict):
                continue
            definition = definitions.get(int(item.get("templateId", 0) or 0))
            if not definition:
                continue
            material = definition.get("material")
            if material and (not item.get("material") or item.get("material") == "Текстиль"):
                item["material"] = material
                changed = True
            if item.get("charismaBonus") == 44682:
                item["charismaBonus"] = 1.5
                changed = True
        if changed:
            data["equipment"] = equipment
            bind.execute(characters.update().where(characters.c.id == row["id"]).values(data=data))


def downgrade():
    pass
