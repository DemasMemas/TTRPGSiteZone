"""make feeder a loading tool

Revision ID: b0e75f1a4c23
Revises: a9d64e0f3b12
Create Date: 2026-07-28 19:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b0e75f1a4c23'
down_revision = 'a9d64e0f3b12'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        'item_templates',
        sa.column('id', sa.Integer),
        sa.column('name', sa.String),
        sa.column('category', sa.String),
        sa.column('subcategory', sa.String),
        sa.column('description', sa.Text),
        sa.column('attributes', sa.JSON),
    )
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.name, templates.c.attributes)
        .where(templates.c.category == 'magazine')
    ).mappings()
    for row in rows:
        if 'подавач' not in str(row['name'] or '').lower():
            continue
        attributes = dict(row['attributes'] or {})
        attributes.pop('capacity', None)
        attributes.pop('caliber', None)
        attributes.pop('universalLoader', None)
        attributes['isLoader'] = False
        attributes['loadingTool'] = 'feeder'
        bind.execute(
            templates.update()
            .where(templates.c.id == row['id'])
            .values(
                subcategory='Инструмент зарядки',
                description='Позволяет заряжать магазин по 10 или 20 патронов.',
                attributes=attributes,
            )
        )


def downgrade():
    pass
