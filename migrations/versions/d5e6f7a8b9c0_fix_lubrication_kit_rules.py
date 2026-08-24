"""fix lubrication kit repair rules

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
"""

from alembic import op
import sqlalchemy as sa


revision = "d5e6f7a8b9c0"
down_revision = "c4d5e6f7a8b9"
branch_labels = None
depends_on = None


KIT_NAME = "набор смазочных приспособлений"
DESCRIPTION = (
    "Позволяет провести полевой ремонт любого оружия, прочностью выше 75. "
    "Чинит 10 единиц прочности. Починка занимает 5 минут. "
    "Позволяет смазывать протезы"
)
PROFILE = {
    "kind": "weapon",
    "repair_amount": 10,
    "duration_minutes": 5,
    "minimum_durability": 75,
    "engineering_min": 0,
    "consumed_on_use": True,
    "can_lubricate_prostheses": True,
}


def _normalized_name(value):
    return " ".join(str(value or "").strip().lower().replace("ё", "е").split())


def _updated_attributes(value, *, downgrade=False):
    attributes = dict(value or {})
    profile = dict(attributes.get("repair_profile") or {})
    if downgrade:
        profile["minimum_durability"] = 0
        profile.pop("can_lubricate_prostheses", None)
    else:
        profile.update(PROFILE)
        attributes["uses"] = 1
        attributes["usable"] = True
    attributes["repair_profile"] = profile
    return attributes


def _update_templates(bind, table_name, *, downgrade=False):
    templates = sa.table(
        table_name,
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("description", sa.Text),
        sa.column("price", sa.Integer),
        sa.column("weight", sa.Float),
        sa.column("volume", sa.Float),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(
            templates.c.id,
            templates.c.name,
            templates.c.attributes,
        ).where(templates.c.category == "tool")
    ).mappings()
    for row in rows:
        if _normalized_name(row["name"]) != KIT_NAME:
            continue
        values = {"attributes": _updated_attributes(row["attributes"], downgrade=downgrade)}
        if not downgrade:
            values.update({
                "description": DESCRIPTION,
                "price": 1500,
                "weight": 0.5,
                "volume": 2.0,
            })
        bind.execute(templates.update().where(templates.c.id == row["id"]).values(**values))


def _update_saved_items(value, *, downgrade=False):
    changed = False
    if isinstance(value, list):
        for item in value:
            changed = _update_saved_items(item, downgrade=downgrade) or changed
        return changed
    if not isinstance(value, dict):
        return False

    if _normalized_name(value.get("name")) == KIT_NAME:
        value["attributes"] = _updated_attributes(value.get("attributes"), downgrade=downgrade)
        if not downgrade:
            value.update({
                "description": DESCRIPTION,
                "price": 1500,
                "weight": 0.5,
                "volume": 2.0,
                "maxUses": 1,
            })
            if "uses" in value:
                value["uses"] = min(1, max(0, int(value.get("uses") or 0)))
        changed = True
    for nested in value.values():
        changed = _update_saved_items(nested, downgrade=downgrade) or changed
    return changed


def _update_characters(bind, *, downgrade=False):
    characters = sa.table(
        "lobby_characters",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )
    for row in bind.execute(sa.select(characters.c.id, characters.c.data)).mappings():
        data = row["data"] if isinstance(row["data"], dict) else {}
        if _update_saved_items(data, downgrade=downgrade):
            bind.execute(
                characters.update().where(characters.c.id == row["id"]).values(data=data)
            )


def upgrade():
    bind = op.get_bind()
    _update_templates(bind, "item_templates")
    _update_templates(bind, "lobby_item_templates")
    _update_characters(bind)


def downgrade():
    bind = op.get_bind()
    _update_templates(bind, "item_templates", downgrade=True)
    _update_templates(bind, "lobby_item_templates", downgrade=True)
    _update_characters(bind, downgrade=True)
