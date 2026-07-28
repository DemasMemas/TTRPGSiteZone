"""Make bipods permanently open and remove the obsolete state flag."""

from alembic import op
import sqlalchemy as sa


revision = "f7d3e5a9c248"
down_revision = "f6c2e4a8b137"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("category", sa.String),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.attributes).where(templates.c.category == "weapon_module")
    ).mappings().all()
    for row in rows:
        attributes = dict(row["attributes"] or {})
        if not attributes.get("bipod"):
            continue
        attributes["deployed"] = True
        bind.execute(templates.update().where(templates.c.id == row["id"]).values(attributes=attributes))

    characters = sa.table(
        "lobby_characters",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
    )
    for row in bind.execute(sa.select(characters.c.id, characters.c.data)).mappings().all():
        data = dict(row["data"] or {})
        weapons = data.get("weapons")
        changed = False
        if isinstance(weapons, list):
            for weapon in weapons:
                if not isinstance(weapon, dict):
                    continue
                for module in weapon.get("installedModules") or []:
                    if isinstance(module, dict) and (
                        module.get("bipod")
                        or (module.get("attributes") or {}).get("bipod")
                        or module.get("name") == "Сошки"
                    ):
                        module["deployed"] = True
                        changed = True
        if changed:
            bind.execute(characters.update().where(characters.c.id == row["id"]).values(data=data))


def downgrade():
    pass
