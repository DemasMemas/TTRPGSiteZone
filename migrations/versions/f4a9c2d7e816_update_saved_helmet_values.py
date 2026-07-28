"""Update already equipped copies of the corrected helmet templates."""

from alembic import op
import sqlalchemy as sa


revision = "f4a9c2d7e816"
down_revision = "f3b9d7e2a815"
branch_labels = None
depends_on = None


VALUES = {
    "Шлем КыСа-2": (8, 4, 1, 5, -0.5, "Плита", {"physical": .20, "chemical": .05, "thermal": 0, "electric": 0, "radiation": 0}),
    "Шлем Гусар": (14, 4, 2, 8, -1, "Кевлар", {"physical": .35, "chemical": .08, "thermal": .05, "electric": 0, "radiation": 0}),
    "Шлем ШЗ-13м": (16, 4, 2, 10, -2, "Кевлар", {"physical": .40, "chemical": .10, "thermal": 0, "electric": 0, "radiation": 0}),
    "Шлем Карбованец": (20, 4, 4, 15, -6, "Плита", {"physical": .60, "chemical": .10, "thermal": .05, "electric": -.10, "radiation": 0}),
    "Шлем Волк-А": (35, 4, 4, 15, -6, "Плита", {"physical": .70, "chemical": .10, "thermal": .05, "electric": -.10, "radiation": 0}),
}


def upgrade():
    bind = op.get_bind()
    table = sa.table("lobby_characters", sa.column("id", sa.Integer), sa.column("data", sa.JSON))
    for row in bind.execute(sa.select(table.c.id, table.c.data)).mappings():
        data = dict(row["data"] or {})
        equipment = dict(data.get("equipment") or {})
        helmet = equipment.get("helmet")
        values = VALUES.get(helmet.get("name")) if isinstance(helmet, dict) else None
        if not values:
            continue
        durability, volume, accuracy, ergonomics, charisma, material, protection = values
        helmet.update({
            "maxDurability": durability,
            "volume": volume,
            "accuracyPenalty": accuracy,
            "ergonomicsPenalty": ergonomics,
            "charismaBonus": charisma,
            "material": material,
            "protection": protection,
        })
        data["equipment"] = equipment
        bind.execute(table.update().where(table.c.id == row["id"]).values(data=data))


def downgrade():
    pass
