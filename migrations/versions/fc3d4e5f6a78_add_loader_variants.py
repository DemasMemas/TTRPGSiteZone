"""add reference loader variants"""

from alembic import op
import sqlalchemy as sa


revision = "fc3d4e5f6a78"
down_revision = "fb2c3d4e5f67"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("category", sa.String),
        sa.column("price", sa.Integer),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.name, templates.c.attributes)
        .where(templates.c.category == "magazine")
    ).mappings().all()

    def update_named(old, new, capacity, price):
        for row in rows:
            if row["name"] != old:
                continue
            attributes = dict(row["attributes"] or {})
            attributes.update({
                "capacity": capacity,
                "caliber": None,
                "isLoader": True,
                "universalLoader": True,
                "loadingDevice": True,
                "ammo": [],
            })
            bind.execute(
                templates.update().where(templates.c.id == row["id"]).values(
                    name=new, price=price, attributes=attributes
                )
            )
            return True
        return False

    update_named(
        "\u0421\u043f\u0438\u0434\u043b\u043e\u0430\u0434\u0435\u0440 \u0443\u043d\u0438\u0432\u0435\u0440\u0441\u0430\u043b\u044c\u043d\u044b\u0439",
        "\u0421\u043f\u0438\u0434\u043b\u043e\u0430\u0434\u0435\u0440 \u0434\u043b\u044f \u0420\u0435\u0432\u043e\u043b\u044c\u0432\u0435\u0440\u0430, \u043a\u0440\u043e\u043c\u0435 \u041e\u0446\u0435\u043b\u043e\u0442-8\u041c\u0421",
        6,
        250,
    )
    update_named(
        "\u041b\u0435\u043d\u0442\u0430 \u0443\u043d\u0438\u0432\u0435\u0440\u0441\u0430\u043b\u044c\u043d\u0430\u044f",
        "\u041b\u0435\u043d\u0442\u0430 \u043d\u0430 5 \u043f\u0430\u0442\u0440\u043e\u043d\u043e\u0432",
        5,
        100,
    )

    existing_names = {row["name"] for row in rows}
    extra = [
        ("\u041b\u0435\u043d\u0442\u0430 \u043d\u0430 10 \u043f\u0430\u0442\u0440\u043e\u043d\u043e\u0432", 10, 200),
        ("\u041b\u0435\u043d\u0442\u0430 \u043d\u0430 15 \u043f\u0430\u0442\u0440\u043e\u043d\u043e\u0432", 15, 350),
        ("\u0421\u043f\u0438\u0434\u043b\u043e\u0430\u0434\u0435\u0440 \u0434\u043b\u044f \u041e\u0446\u0435\u043b\u043e\u0442-8\u041c\u0421", 12, 800),
    ]
    for name, capacity, price in extra:
        if name in existing_names:
            continue
        bind.execute(
            templates.insert().values(
                name=name,
                category="magazine",
                price=price,
                attributes={
                    "capacity": capacity,
                    "caliber": None,
                    "isLoader": True,
                    "universalLoader": True,
                    "loadingDevice": True,
                    "ammo": [],
                },
            )
        )


def downgrade():
    pass
