"""add world rule artifacts

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
"""

import json
from pathlib import Path

from alembic import op
import sqlalchemy as sa


revision = "f7a8b9c0d1e2"
down_revision = "e6f7a8b9c0d1"
branch_labels = None
depends_on = None


def _catalog():
    path = Path(__file__).resolve().parents[2] / "app" / "data" / "world_rules.json"
    return json.loads(path.read_text(encoding="utf-8"))["artifacts"]


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        "item_templates",
        sa.column("id", sa.Integer), sa.column("name", sa.String),
        sa.column("category", sa.String), sa.column("subcategory", sa.String),
        sa.column("item_class", sa.String), sa.column("description", sa.Text),
        sa.column("price", sa.Integer), sa.column("weight", sa.Float),
        sa.column("volume", sa.Float), sa.column("attributes", sa.JSON),
        sa.column("compatible_ids", sa.JSON),
    )
    for artifact in _catalog():
        attributes = {
            "import_source": "world_rules",
            "source_order": artifact["source_order"],
            "artifact_class": artifact["artifact_class"],
            "anomaly_type": artifact["anomaly_type"],
            "positive_effect": artifact["positive_effect"],
            "negative_effect": artifact["negative_effect"],
            "special_property": artifact["special_property"],
            "special_recharge_hours": 24,
        }
        values = {
            "name": artifact["name"], "category": "artifact",
            "subcategory": artifact["anomaly_type"],
            "item_class": artifact["artifact_class"],
            "description": artifact["appearance"], "price": artifact["price"],
            "weight": artifact["weight"], "volume": 1.0,
            "attributes": attributes, "compatible_ids": [],
        }
        existing = bind.execute(sa.select(templates.c.id).where(
            templates.c.category == "artifact", templates.c.name == artifact["name"],
        )).first()
        if existing:
            bind.execute(templates.update().where(templates.c.id == existing[0]).values(**values))
        else:
            bind.execute(templates.insert().values(**values))


def downgrade():
    templates = sa.table(
        "item_templates", sa.column("id", sa.Integer),
        sa.column("category", sa.String), sa.column("attributes", sa.JSON),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(
        templates.c.id, templates.c.attributes,
    ).where(templates.c.category == "artifact")).all()
    imported_ids = [
        row[0] for row in rows
        if isinstance(row[1], dict) and row[1].get("import_source") == "world_rules"
    ]
    if imported_ids:
        bind.execute(templates.delete().where(templates.c.id.in_(imported_ids)))
