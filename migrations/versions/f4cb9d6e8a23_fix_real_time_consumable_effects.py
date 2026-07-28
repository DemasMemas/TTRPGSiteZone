"""fix real time consumable effects

Revision ID: f4cb9d6e8a23
Revises: e3ba8c5d7f12
"""

from alembic import op
import sqlalchemy as sa


revision = "f4cb9d6e8a23"
down_revision = "e3ba8c5d7f12"
branch_labels = None
depends_on = None


def _repair_effect(effect):
    if not isinstance(effect, dict):
        return
    name = str(effect.get("name") or "").lower()
    if effect.get("type") == "delayed_adjustment" and "5 минут" in name:
        effect.update({
            "remaining": 5,
            "tick": "time_elapsed",
            "time_unit": "minute",
            "remaining_seconds": 300,
        })
    if effect.get("type") == "limb_trauma_suppression":
        effect.update({
            "remaining": 10,
            "tick": "time_elapsed",
            "time_unit": "minute",
            "remaining_seconds": 600,
        })


def _repair_character(value):
    if isinstance(value, list):
        for item in value:
            _repair_character(item)
        return
    if not isinstance(value, dict):
        return
    if value.get("type") in {"delayed_adjustment", "limb_trauma_suppression"}:
        _repair_effect(value)
    for nested in value.values():
        _repair_character(nested)


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("subcategory", sa.String),
        sa.column("description", sa.Text),
        sa.column("price", sa.Integer),
        sa.column("weight", sa.Float),
        sa.column("volume", sa.Float),
        sa.column("attributes", sa.JSON),
        sa.column("compatible_ids", sa.JSON),
    )
    existing_names = {
        str(name).strip().lower()
        for name in bind.execute(sa.select(templates.c.name)).scalars()
    }
    if "зажигалка" not in existing_names:
        bind.execute(templates.insert().values(
            name="Зажигалка",
            category="device",
            subcategory="fire_source",
            description="Позволяет поджигать костры и сигареты",
            price=150,
            weight=0.1,
            volume=0.05,
            attributes={"fire_source": "lighter", "not_consumed": True},
            compatible_ids=[],
        ))
    if "спички (10 штук)" not in existing_names:
        bind.execute(templates.insert().values(
            name="Спички (10 штук)",
            category="consumable",
            subcategory="fire_source",
            description="Позволяют поджигать костры и сигареты",
            price=25,
            weight=0.0,
            volume=0.05,
            attributes={"uses": 10, "fire_source": "matches"},
            compatible_ids=[],
        ))
    for row in bind.execute(sa.select(
        templates.c.id, templates.c.name, templates.c.category, templates.c.attributes
    ).where(templates.c.category == "consumable")).mappings():
        attributes = dict(row["attributes"] or {})
        consumable = dict(attributes.get("consumable") or {})
        direct = dict(consumable.get("direct") or {})
        name = str(row["name"] or "").lower()
        if any(fragment in name for fragment in ("самокрут", "сигарет", "сигар")):
            direct["requires_fire"] = True
        effects = [dict(effect) for effect in (consumable.get("effects") or [])]
        for effect in effects:
            _repair_effect(effect)
        consumable["direct"] = direct
        consumable["effects"] = effects
        attributes["consumable"] = consumable
        bind.execute(
            templates.update().where(templates.c.id == row["id"]).values(attributes=attributes)
        )

    characters = sa.table(
        "lobby_characters",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )
    for row in bind.execute(sa.select(characters.c.id, characters.c.data)).mappings():
        data = dict(row["data"] or {})
        _repair_character(data)
        bind.execute(
            characters.update().where(characters.c.id == row["id"]).values(data=data)
        )


def downgrade():
    pass
