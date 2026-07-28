"""add global speedloaders, feeders and belts"""

from alembic import op
import sqlalchemy as sa


revision = "fa1b2c3d4e56"
down_revision = "f7d3e5a9c248"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
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

    existing = {
        row[0]
        for row in bind.execute(
            sa.select(templates.c.name).where(templates.c.category == "magazine")
        )
    }
    devices = [
        (
            "\u0421\u043f\u0438\u0434\u043b\u043e\u0430\u0434\u0435\u0440 \u0443\u043d\u0438\u0432\u0435\u0440\u0441\u0430\u043b\u044c\u043d\u044b\u0439",
            "\u0411\u044b\u0441\u0442\u0440\u0430\u044f \u0437\u0430\u0440\u044f\u0434\u043a\u0430 \u043d\u0435\u0441\u044a\u0451\u043c\u043d\u044b\u0445 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u043e\u0432",
            20,
            0.25,
        ),
        (
            "\u041f\u043e\u0434\u0430\u0432\u0430\u0447",
            "\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442 \u0434\u043b\u044f \u0437\u0430\u0440\u044f\u0434\u043a\u0438 \u043c\u0430\u0433\u0430\u0437\u0438\u043d\u0430",
            20,
            0.1,
        ),
        (
            "\u041b\u0435\u043d\u0442\u0430 \u0443\u043d\u0438\u0432\u0435\u0440\u0441\u0430\u043b\u044c\u043d\u0430\u044f",
            "\u0417\u0430\u0440\u044f\u0434\u043a\u0430 \u043e\u0440\u0443\u0436\u0438\u044f \u043b\u0435\u043d\u0442\u043e\u0439",
            50,
            0.5,
        ),
    ]
    for name, description, capacity, volume in devices:
        if name in existing:
            continue
        bind.execute(
            templates.insert().values(
                name=name,
                category="magazine",
                subcategory="\u0418\u043d\u0441\u0442\u0440\u0443\u043c\u0435\u043d\u0442 \u0437\u0430\u0440\u044f\u0434\u043a\u0438",
                item_class="\u0417\u0430\u0433\u0440\u0443\u0437\u043e\u0447\u043d\u043e\u0435 \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e",
                description=description,
                price=0,
                weight=0.1,
                volume=volume,
                attributes={
                    "capacity": capacity,
                    "caliber": None,
                    "isLoader": True,
                    "universalLoader": True,
                    "loadingDevice": True,
                    "ammo": [],
                },
                compatible_ids=[],
            )
        )


def downgrade():
    pass
