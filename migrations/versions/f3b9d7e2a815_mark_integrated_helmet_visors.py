"""Mark face-protecting helmets as having an integrated visor."""

from alembic import op
import sqlalchemy as sa


revision = "f3b9d7e2a815"
down_revision = "f2a8c6e1b704"
branch_labels = None
depends_on = None


HELMET_DATA = {
    "Шлем КыСа-2": {
        "max_durability": 8,
        "protection": {"physical": 0.20, "chemical": 0.05, "thermal": 0, "electric": 0, "radiation": 0},
        "armor_type": "Плита", "material": "Плита", "volume": 4,
        "accuracy_penalty": 1, "ergonomics_penalty": 5, "charisma_bonus": -0.5,
    },
    "Шлем Гусар": {
        "max_durability": 14,
        "protection": {"physical": 0.35, "chemical": 0.08, "thermal": 0.05, "electric": 0, "radiation": 0},
        "armor_type": "Кевлар", "material": "Кевлар", "volume": 4,
        "accuracy_penalty": 2, "ergonomics_penalty": 8, "charisma_bonus": -1,
    },
    "Шлем ШЗ-13м": {
        "max_durability": 16,
        "protection": {"physical": 0.40, "chemical": 0.10, "thermal": 0, "electric": 0, "radiation": 0},
        "armor_type": "Кевлар", "material": "Кевлар", "volume": 4,
        "accuracy_penalty": 2, "ergonomics_penalty": 10, "charisma_bonus": -2,
    },
    "Шлем Карбованец": {
        "max_durability": 20,
        "protection": {"physical": 0.60, "chemical": 0.10, "thermal": 0.05, "electric": -0.10, "radiation": 0},
        "armor_type": "Плита", "material": "Плита", "volume": 4,
        "accuracy_penalty": 4, "ergonomics_penalty": 15, "charisma_bonus": -6,
    },
    "Шлем Волк-А": {
        "max_durability": 35,
        "protection": {"physical": 0.70, "chemical": 0.10, "thermal": 0.05, "electric": -0.10, "radiation": 0},
        "armor_type": "Плита", "material": "Плита", "volume": 4,
        "accuracy_penalty": 4, "ergonomics_penalty": 15, "charisma_bonus": -6,
    },
}


def _update_templates(bind, table_name):
    table = sa.table(
        table_name,
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("volume", sa.Float),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(table.c.id, table.c.name, table.c.volume, table.c.attributes)
        .where(table.c.category == "helmet")
    ).mappings().all()
    for row in rows:
        attributes = dict(row["attributes"] or {})
        if "face" in (attributes.get("protection_zones") or []):
            attributes["integrated_visor"] = True
        exact = HELMET_DATA.get(row["name"])
        values = {"attributes": attributes}
        if exact:
            attributes.update({key: value for key, value in exact.items() if key != "volume"})
            values["volume"] = exact["volume"]
        bind.execute(table.update().where(table.c.id == row["id"]).values(**values))


def _update_saved_equipment(bind):
    characters = sa.table(
        "lobby_characters",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )
    for row in bind.execute(sa.select(characters.c.id, characters.c.data)).mappings():
        data = dict(row["data"] or {})
        equipment = dict(data.get("equipment") or {})
        helmet = equipment.get("helmet")
        if not isinstance(helmet, dict) or helmet.get("name") not in HELMET_DATA:
            continue
        values = HELMET_DATA[helmet["name"]]
        helmet.update({
            "durability": helmet.get("durability", values["max_durability"]),
            "maxDurability": values["max_durability"],
            "volume": values["volume"],
            "material": values["material"],
            "accuracyPenalty": values["accuracy_penalty"],
            "ergonomicsPenalty": values["ergonomics_penalty"],
            "charismaBonus": values["charisma_bonus"],
            "protection": values["protection"],
        })
        data["equipment"] = equipment
        bind.execute(characters.update().where(characters.c.id == row["id"]).values(data=data))


def upgrade():
    bind = op.get_bind()
    _update_templates(bind, "item_templates")
    _update_templates(bind, "lobby_item_templates")
    _update_saved_equipment(bind)


def downgrade():
    pass
