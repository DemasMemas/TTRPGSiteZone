"""Remove the obsolete visor slot from helmets.

Visors are now part of the helmet protection profile.  Their future
modifications are kept separately so they can be reintroduced without
bringing back a wearable visor slot.
"""

from alembic import op
import sqlalchemy as sa


revision = "f2a8c6e1b704"
down_revision = "e4a7c1d9b502"
branch_labels = None
depends_on = None


def _without_visor_slot(attributes):
    attributes = dict(attributes or {})
    slots = [
        slot for slot in (attributes.get("slots") or [])
        if not isinstance(slot, dict) or slot.get("type") != "visor"
    ]
    if slots:
        attributes["slots"] = slots
    else:
        attributes.pop("slots", None)
    return attributes


def upgrade():
    bind = op.get_bind()
    for table_name in ("item_templates", "lobby_item_templates"):
        table = sa.table(
            table_name,
            sa.column("id", sa.Integer),
            sa.column("category", sa.String),
            sa.column("attributes", sa.JSON),
        )
        rows = bind.execute(
            sa.select(table.c.id, table.c.attributes).where(table.c.category == "helmet")
        ).mappings().all()
        for row in rows:
            updated = _without_visor_slot(row["attributes"])
            if updated != (row["attributes"] or {}):
                bind.execute(table.update().where(table.c.id == row["id"]).values(attributes=updated))

    characters = sa.table(
        "lobby_characters",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )
    for row in bind.execute(sa.select(characters.c.id, characters.c.data)).mappings():
        data = dict(row["data"] or {})
        equipment = dict(data.get("equipment") or {})
        helmet = equipment.get("helmet")
        if not isinstance(helmet, dict):
            continue

        modules = list(helmet.get("installedModules") or [])
        visor_modules = [module for module in modules if module.get("slotType") == "visor"]
        if not visor_modules:
            continue

        preserved = list(helmet.get("visorModifications") or [])
        for module in visor_modules:
            preserved.extend(module.get("modifications") or [])
        helmet["visorModifications"] = preserved
        helmet["installedModules"] = [module for module in modules if module.get("slotType") != "visor"]
        data["equipment"] = equipment
        bind.execute(characters.update().where(characters.c.id == row["id"]).values(data=data))


def downgrade():
    pass
