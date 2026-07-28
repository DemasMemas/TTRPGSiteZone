"""import global backpacks and migrate equipped backpack state

Revision ID: a5dc0e7f9b34
Revises: f4cb9d6e8a23
"""

from alembic import op
import sqlalchemy as sa


revision = "a5dc0e7f9b34"
down_revision = "f4cb9d6e8a23"
branch_labels = None
depends_on = None


BACKPACKS = (
    ("Спортивный рюкзак", 1500, 20, 0),
    ("Рюкзак", 3000, 40, 0),
    ("Разгрузочный рюкзак", 7500, 40, 1),
    ("Большой рюкзак", 15000, 100, 1),
)


def upgrade():
    bind = op.get_bind()
    global_templates = sa.table(
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
    local_templates = sa.table(
        "lobby_item_templates",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
    )
    characters = sa.table(
        "lobby_characters",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )

    local_names = {
        int(row["id"]): str(row["name"])
        for row in bind.execute(
            sa.select(local_templates.c.id, local_templates.c.name)
            .where(local_templates.c.category == "backpack")
        ).mappings()
    }

    global_ids = {}
    for name, price, capacity, weight_reduction in BACKPACKS:
        existing = bind.execute(
            sa.select(global_templates.c.id)
            .where(global_templates.c.category == "backpack")
            .where(sa.func.lower(global_templates.c.name) == name.lower())
        ).scalar()
        values = {
            "name": name,
            "category": "backpack",
            "subcategory": None,
            "description": f"Вместимость: {capacity} ячеек.",
            "price": price,
            "weight": 0.0,
            "volume": 0.0,
            "attributes": {
                "limit": capacity,
                "capacity": capacity,
                "weight_reduction": weight_reduction,
            },
            "compatible_ids": [],
        }
        if existing is None:
            existing = bind.execute(
                global_templates.insert()
                .values(**values)
                .returning(global_templates.c.id)
            ).scalar_one()
        else:
            bind.execute(
                global_templates.update()
                .where(global_templates.c.id == existing)
                .values(**values)
            )
        global_ids[name.lower()] = int(existing)

    for row in bind.execute(sa.select(characters.c.id, characters.c.data)).mappings():
        data = dict(row["data"] or {})
        inventory = dict(data.get("inventory") or {})
        equipment = dict(data.get("equipment") or {})
        legacy_model = inventory.get("backpackModel")
        if not equipment.get("backpack") and legacy_model not in (None, ""):
            try:
                model_id = int(legacy_model)
            except (TypeError, ValueError):
                model_id = 0
            local_id = model_id - 1_000_000 if model_id >= 1_000_000 else model_id
            legacy_name = local_names.get(local_id, "")
            template_id = global_ids.get(legacy_name.lower())
            definition = next(
                (item for item in BACKPACKS if item[0].lower() == legacy_name.lower()),
                None,
            )
            if template_id and definition:
                name, price, capacity, weight_reduction = definition
                equipment["backpack"] = {
                    "id": f"migrated_backpack_{row['id']}",
                    "templateId": template_id,
                    "name": name,
                    "category": "backpack",
                    "quantity": 1,
                    "price": price,
                    "weight": 0.0,
                    "volume": 0.0,
                    "attributes": {
                        "limit": capacity,
                        "capacity": capacity,
                        "weight_reduction": weight_reduction,
                    },
                    "isContainer": True,
                    "isEquippable": True,
                }
        inventory.pop("backpackModel", None)
        data["inventory"] = inventory
        data["equipment"] = equipment
        bind.execute(
            characters.update().where(characters.c.id == row["id"]).values(data=data)
        )

    bind.execute(
        local_templates.delete().where(local_templates.c.category == "backpack")
    )


def downgrade():
    pass
