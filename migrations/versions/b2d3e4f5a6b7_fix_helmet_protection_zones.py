"""fix helmet protection zones from the equipment rulebook"""

from alembic import op
import sqlalchemy as sa


revision = "b2d3e4f5a6b7"
down_revision = "a1c2d3e4f5a6"
branch_labels = None
depends_on = None


CROWN_BACK = {"Советский Котелок 68Г", "Шлем Ударник"}
CROWN_BACK_EARS = {"Шлем Витязь 4В76", "Шлем Ударник-М", "Шлем Первопроходец"}


def _zones(name):
    if name in CROWN_BACK:
        return ["crown", "back"]
    if name in CROWN_BACK_EARS:
        return ["crown", "back", "ears"]
    return ["crown", "back", "ears", "face"]


def _update_template_table(bind, table_name):
    table = sa.table(
        table_name,
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(table.c.id, table.c.name, table.c.attributes)
        .where(table.c.category == "helmet")
    ).mappings()
    for row in rows:
        attributes = dict(row["attributes"] or {})
        attributes["protection_zones"] = _zones(row["name"])
        bind.execute(
            table.update().where(table.c.id == row["id"]).values(attributes=attributes)
        )


def upgrade():
    bind = op.get_bind()
    _update_template_table(bind, "item_templates")
    _update_template_table(bind, "lobby_item_templates")

    characters = sa.table(
        "lobby_characters",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )
    for row in bind.execute(sa.select(characters.c.id, characters.c.data)).mappings():
        data = dict(row["data"] or {})
        equipment = dict(data.get("equipment") or {})
        helmet = equipment.get("helmet")
        if not isinstance(helmet, dict) or not helmet.get("name"):
            continue
        zones = _zones(helmet["name"])
        helmet["protectionZones"] = zones
        attributes = dict(helmet.get("attributes") or {})
        attributes["protection_zones"] = zones
        helmet["attributes"] = attributes
        data["equipment"] = equipment
        bind.execute(
            characters.update().where(characters.c.id == row["id"]).values(data=data)
        )


def downgrade():
    pass
