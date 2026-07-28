"""normalize shotgun ammo calibers"""

from alembic import op
import sqlalchemy as sa
import re


revision = "fb2c3d4e5f67"
down_revision = "fa1b2c3d4e56"
branch_labels = None
depends_on = None


def _base_caliber(value):
    text = str(value or "").strip().lower()
    text = text.replace("х", "x").replace("×", "x").replace("*", "x")
    match = re.match(r"^(\d+(?:[.,]\d+)?x\d+)", text)
    return match.group(1).replace(",", ".") if match else value


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("attributes", sa.JSON),
    )
    for row in bind.execute(sa.select(templates.c.id, templates.c.attributes)).mappings():
        attributes = dict(row["attributes"] or {})
        caliber = attributes.get("caliber")
        normalized = _base_caliber(caliber)
        if normalized != caliber:
            attributes["caliber"] = normalized
            bind.execute(
                templates.update()
                .where(templates.c.id == row["id"])
                .values(attributes=attributes)
            )


def downgrade():
    pass
