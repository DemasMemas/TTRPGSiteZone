"""fix grenade launcher calibers

Revision ID: e3ba8c5d7f12
Revises: d2a97b4c6e01
"""

from alembic import op
import sqlalchemy as sa


revision = "e3ba8c5d7f12"
down_revision = "d2a97b4c6e01"
branch_labels = None
depends_on = None


CALIBERS = {
    "вог-25": "ВОГ-25",
    "ог-12": "ОГ-12",
    "n-101-2": "N-101-2",
}


def _canonical(value):
    text = str(value or "").strip()
    lowered = text.lower()
    if lowered.startswith("граната "):
        lowered = lowered[8:].strip()
    return CALIBERS.get(lowered, text)


def _repair(value):
    if isinstance(value, list):
        for item in value:
            _repair(item)
        return
    if not isinstance(value, dict):
        return
    name = str(value.get("name") or "").strip()
    attributes = value.get("attributes")
    if isinstance(attributes, dict):
        caliber = attributes.get("caliber")
        repaired = _canonical(caliber)
        if repaired != caliber:
            attributes["caliber"] = repaired
        if value.get("category") == "grenade" and name.lower() in CALIBERS:
            attributes["caliber"] = CALIBERS[name.lower()]
    caliber = value.get("caliber")
    repaired = _canonical(caliber)
    if repaired != caliber:
        value["caliber"] = repaired
    for nested in value.values():
        _repair(nested)


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("attributes", sa.JSON),
    )
    for row in bind.execute(sa.select(
        templates.c.id, templates.c.name, templates.c.category, templates.c.attributes
    )).mappings():
        attributes = dict(row["attributes"] or {})
        caliber = _canonical(attributes.get("caliber"))
        if row["category"] == "grenade" and str(row["name"]).lower() in CALIBERS:
            caliber = CALIBERS[str(row["name"]).lower()]
        if caliber:
            attributes["caliber"] = caliber
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
        _repair(data)
        bind.execute(
            characters.update().where(characters.c.id == row["id"]).values(data=data)
        )


def downgrade():
    pass
