"""add body carrying rope

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
"""

from alembic import op
import sqlalchemy as sa


revision = "e6f7a8b9c0d1"
down_revision = "d5e6f7a8b9c0"
branch_labels = None
depends_on = None


ROPE_NAME = "Канат для переноски"


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("subcategory", sa.String),
        sa.column("item_class", sa.String),
        sa.column("description", sa.Text),
        sa.column("price", sa.Integer),
        sa.column("weight", sa.Float),
        sa.column("volume", sa.Float),
        sa.column("attributes", sa.JSON),
        sa.column("compatible_ids", sa.JSON),
    )
    existing = bind.execute(
        sa.select(templates.c.id).where(
            sa.func.lower(templates.c.name) == ROPE_NAME.lower(),
            templates.c.category == "tool",
        )
    ).first()
    values = {
        "name": ROPE_NAME,
        "category": "tool",
        "subcategory": "Инструменты",
        "item_class": None,
        "description": (
            "Небольшое устройство, которое позволяет тащить бессознательное тело. "
            "Штраф перемещения: 1 + половина штрафа от веса на теле."
        ),
        "price": 1000,
        "weight": 0.5,
        "volume": 4.0,
        "attributes": {
            "import_source": "rules",
            "section": "Инструменты",
            "body_carry_rope": True,
            "usable": False,
        },
        "compatible_ids": [],
    }
    if existing:
        bind.execute(
            templates.update().where(templates.c.id == existing[0]).values(**values)
        )
    else:
        bind.execute(templates.insert().values(**values))


def downgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("name", sa.String),
        sa.column("category", sa.String),
    )
    bind.execute(
        templates.delete().where(
            templates.c.name == ROPE_NAME,
            templates.c.category == "tool",
        )
    )
