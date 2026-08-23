"""update melee weapon prices and tomahawk attacks"""

from alembic import op
import sqlalchemy as sa


revision = "c4d5e6f7a8b9"
down_revision = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


NEW_PRICES = {
    "Спиральный нож": 3500,
    "Топор": 5000,
    "Сабля": 8000,
    "Кортик": 9000,
    "Кувалда": 10000,
    "Меч": 10000,
}
OLD_PRICES = {
    "Спиральный нож": 1750,
    "Топор": 2500,
    "Сабля": 4000,
    "Кортик": 4500,
    "Кувалда": 5000,
    "Меч": 5000,
}


def _remove_cutting(attacks):
    if not isinstance(attacks, list):
        return attacks
    return [
        attack for attack in attacks
        if "режущ" not in str(attack).lower().replace("ё", "е")
    ]


def _update_saved_item(value, prices, restore_tomahawk=False):
    changed = False
    if isinstance(value, list):
        for item in value:
            changed = _update_saved_item(item, prices, restore_tomahawk) or changed
        return changed
    if not isinstance(value, dict):
        return False

    name = str(value.get("name") or "").strip()
    if name in prices and value.get("price") != prices[name]:
        value["price"] = prices[name]
        changed = True
    if name == "Томагавк":
        attributes = value.get("attributes")
        if isinstance(attributes, dict):
            attacks = attributes.get("allowed_attacks")
            updated = list(attacks) if isinstance(attacks, list) else attacks
            if restore_tomahawk and isinstance(updated, list) and not any(
                "режущ" in str(attack).lower().replace("ё", "е") for attack in updated
            ):
                updated.append("Режущий")
            elif not restore_tomahawk:
                updated = _remove_cutting(updated)
            if updated != attacks:
                attributes["allowed_attacks"] = updated
                changed = True
    for nested in value.values():
        changed = _update_saved_item(nested, prices, restore_tomahawk) or changed
    return changed


def _update_templates(bind, table_name, prices, restore_tomahawk=False):
    table = sa.table(
        table_name,
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("price", sa.Integer),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(table.c.id, table.c.name, table.c.price, table.c.attributes)
        .where(table.c.category == "melee_weapon")
    ).mappings()
    for row in rows:
        values = {}
        if row["name"] in prices:
            values["price"] = prices[row["name"]]
        if row["name"] == "Томагавк":
            attributes = dict(row["attributes"] or {})
            attacks = attributes.get("allowed_attacks")
            updated = list(attacks) if isinstance(attacks, list) else attacks
            if restore_tomahawk and isinstance(updated, list) and not any(
                "режущ" in str(attack).lower().replace("ё", "е") for attack in updated
            ):
                updated.append("Режущий")
            elif not restore_tomahawk:
                updated = _remove_cutting(updated)
            if updated != attacks:
                attributes["allowed_attacks"] = updated
                values["attributes"] = attributes
        if values:
            bind.execute(table.update().where(table.c.id == row["id"]).values(**values))


def _update_characters(bind, prices, restore_tomahawk=False):
    characters = sa.table(
        "lobby_characters",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )
    for row in bind.execute(sa.select(characters.c.id, characters.c.data)).mappings():
        data = row["data"] if isinstance(row["data"], dict) else {}
        if _update_saved_item(data, prices, restore_tomahawk):
            bind.execute(
                characters.update().where(characters.c.id == row["id"]).values(data=data)
            )


def upgrade():
    bind = op.get_bind()
    _update_templates(bind, "item_templates", NEW_PRICES)
    _update_templates(bind, "lobby_item_templates", NEW_PRICES)
    _update_characters(bind, NEW_PRICES)


def downgrade():
    bind = op.get_bind()
    _update_templates(bind, "item_templates", OLD_PRICES, restore_tomahawk=True)
    _update_templates(bind, "lobby_item_templates", OLD_PRICES, restore_tomahawk=True)
    _update_characters(bind, OLD_PRICES, restore_tomahawk=True)
