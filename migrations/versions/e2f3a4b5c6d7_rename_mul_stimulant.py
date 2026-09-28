"""Rename the Mule stimulant to Bull in templates and stored inventories."""

from alembic import op
import sqlalchemy as sa


revision = "e2f3a4b5c6d7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None

OLD_NAME = "Стимулятор Мул"
NEW_NAME = "Стимулятор Бык"


def _replace_json_name(value, old_name, new_name):
    if isinstance(value, list):
        changed = False
        result = []
        for item in value:
            updated, item_changed = _replace_json_name(item, old_name, new_name)
            result.append(updated)
            changed = changed or item_changed
        return result, changed
    if isinstance(value, dict):
        changed = False
        result = {}
        for key, item in value.items():
            updated, item_changed = _replace_json_name(item, old_name, new_name)
            result[key] = updated
            changed = changed or item_changed
        return result, changed
    if value == old_name:
        return new_name, True
    return value, False


def _rename_templates(bind, table_name, old_name, new_name):
    table = sa.table(
        table_name,
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
    )
    bind.execute(
        table.update().where(table.c.name == old_name).values(name=new_name)
    )


def _rename_json_column(bind, table_name, column_name, old_name, new_name):
    table = sa.table(
        table_name,
        sa.column("id", sa.Integer),
        sa.column(column_name, sa.JSON),
    )
    for row in bind.execute(sa.select(table.c.id, table.c[column_name])).mappings():
        updated, changed = _replace_json_name(row[column_name], old_name, new_name)
        if changed:
            bind.execute(
                table.update().where(table.c.id == row["id"]).values({column_name: updated})
            )


def _rename(old_name, new_name):
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    for table_name in ("item_templates", "lobby_item_templates"):
        if table_name in tables:
            _rename_templates(bind, table_name, old_name, new_name)
    for table_name, column_name in (
        ("lobby_characters", "data"),
        ("location_objects", "properties"),
        ("deferred_combat_actions", "payload"),
    ):
        if table_name in tables:
            _rename_json_column(bind, table_name, column_name, old_name, new_name)


def upgrade():
    _rename(OLD_NAME, NEW_NAME)


def downgrade():
    _rename(NEW_NAME, OLD_NAME)
