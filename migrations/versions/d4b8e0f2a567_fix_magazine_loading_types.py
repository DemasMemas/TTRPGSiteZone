"""fix magazine loading device types

Revision ID: d4b8e0f2a567
Revises: d3a7c9e1f456
Create Date: 2026-07-28 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'd4b8e0f2a567'
down_revision = 'd3a7c9e1f456'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        'item_templates',
        sa.column('id', sa.Integer),
        sa.column('name', sa.String),
        sa.column('category', sa.String),
        sa.column('attributes', sa.JSON),
    )
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.name, templates.c.attributes)
        .where(templates.c.category == 'magazine')
    ).mappings()
    for row in rows:
        name = str(row['name'] or '')
        normalized = name.lower()
        attributes = dict(row['attributes'] or {})
        if normalized.startswith('магазин в ') and not attributes.get('capacity'):
            bind.execute(templates.delete().where(templates.c.id == row['id']))
            continue
        is_loading_device = any(word in normalized for word in ('клипса', 'подавач', 'лента'))
        if attributes.get('isLoader') != is_loading_device:
            attributes['isLoader'] = is_loading_device
            bind.execute(
                templates.update()
                .where(templates.c.id == row['id'])
                .values(attributes=attributes)
            )


def downgrade():
    pass
