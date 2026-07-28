"""rename revolver speedloaders"""

from alembic import op
import sqlalchemy as sa


revision = "fd4e5f6a7b89"
down_revision = "fc3d4e5f6a78"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer),
        sa.column("name", sa.String),
        sa.column("attributes", sa.JSON),
    )
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.name, templates.c.attributes)
    ).mappings().all()
    names = {
        "\u0421\u043f\u0438\u0434\u043b\u043e\u0430\u0434\u0435\u0440 \u0434\u043b\u044f \u0420\u0435\u0432\u043e\u043b\u044c\u0432\u0435\u0440\u0430, \u043a\u0440\u043e\u043c\u0435 \u041e\u0446\u0435\u043b\u043e\u0442-8\u041c\u0421": "\u0421\u043f\u0438\u0434\u043b\u043e\u0430\u0434\u0435\u0440 \u0434\u043b\u044f \u0440\u0435\u0432\u043e\u043b\u044c\u0432\u0435\u0440\u0430",
        "\u0421\u043f\u0438\u0434\u043b\u043e\u0430\u0434\u0435\u0440 \u0434\u043b\u044f \u041e\u0446\u0435\u043b\u043e\u0442-8\u041c\u0421": "\u0421\u043f\u0438\u0434\u043b\u043e\u0430\u0434\u0435\u0440 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043d\u043d\u044b\u0439 \u0434\u043b\u044f \u0440\u0435\u0432\u043e\u043b\u044c\u0432\u0435\u0440\u0430",
    }
    for row in rows:
        new_name = names.get(row["name"])
        if not new_name:
            continue
        attributes = dict(row["attributes"] or {})
        attributes["universalLoader"] = True
        attributes["loadingDevice"] = True
        bind.execute(
            templates.update().where(templates.c.id == row["id"]).values(
                name=new_name,
                attributes=attributes,
            )
        )


def downgrade():
    pass
