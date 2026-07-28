"""Add the bipod weapon module."""

from alembic import op
import sqlalchemy as sa


revision = "f5b1d3e7a926"
down_revision = "f4a9c2d7e816"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    table = sa.table(
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
    exists = bind.execute(
        sa.select(table.c.id).where(
            sa.and_(table.c.category == "weapon_module", table.c.name == "\u0421\u043e\u0448\u043a\u0438")
        )
    ).first()
    if exists:
        return
    bind.execute(table.insert().values(
        name="\u0421\u043e\u0448\u043a\u0438",
        category="weapon_module",
        subcategory="handguard",
        item_class="2",
        description="\u041e\u0442\u043a\u0440\u044b\u0432\u0430\u044e\u0442\u0441\u044f \u0438 \u0437\u0430\u043a\u0440\u044b\u0432\u0430\u044e\u0442\u0441\u044f. \u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u044d\u0444\u0444\u0435\u043a\u0442 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u0440\u0438 \u0443\u0441\u0442\u0430\u043d\u043e\u0432\u043a\u0435 \u043e\u0440\u0443\u0436\u0438\u044f \u043d\u0430 \u0443\u043f\u043e\u0440.",
        price=5000,
        weight=0.5,
        volume=0.5,
        attributes={
            "slot_type": "handguard",
            "bipod": True,
            "deployed": True,
            "modifiers": {"ergonomics": -30},
            "main_effect": {"ergonomics": 75, "requires_rest": True},
            "description": "\u0422\u0440\u0435\u0431\u043e\u0432\u0430\u043d\u0438\u0435 \u043a \u0441\u0438\u043b\u0435 \u043d\u0435 \u043f\u0440\u0438\u043c\u0435\u043d\u044f\u0435\u0442\u0441\u044f \u0434\u043b\u044f \u043e\u0440\u0443\u0436\u0438\u044f \u043d\u0430 \u0441\u043e\u0448\u043a\u0430\u0445.",
        },
        compatible_ids=[],
    ))


def downgrade():
    bind = op.get_bind()
    table = sa.table(
        "item_templates",
        sa.column("name", sa.String),
        sa.column("category", sa.String),
    )
    bind.execute(table.delete().where(sa.and_(table.c.category == "weapon_module", table.c.name == "\u0421\u043e\u0448\u043a\u0438")))
