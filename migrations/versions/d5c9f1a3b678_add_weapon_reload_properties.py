"""add fixed magazine and manual cycle properties

Revision ID: d5c9f1a3b678
Revises: d4b8e0f2a567
Create Date: 2026-07-28 15:20:00.000000

"""
import re

from alembic import op
import sqlalchemy as sa


revision = 'd5c9f1a3b678'
down_revision = 'd4b8e0f2a567'
branch_labels = None
depends_on = None


def _key(value):
    return re.sub(r'[^0-9a-zа-я]+', '', str(value or '').lower())


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        'item_templates',
        sa.column('id', sa.Integer),
        sa.column('name', sa.String),
        sa.column('category', sa.String),
        sa.column('attributes', sa.JSON),
    )
    bolt_names = {_key(value) for value in (
        'Суслик', 'Малинова', 'Мачеха 51', 'Свет-99', 'АУ', 'Пылесос',
    )}
    pump_names = {_key(value) for value in (
        'Гора Б88', 'Гора 580Б2', 'Ремень 787', 'Спаситель 70', 'Д-2', 'Д2',
    )}
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.name, templates.c.attributes)
        .where(templates.c.category == 'weapon')
    ).mappings()
    for row in rows:
        attributes = dict(row['attributes'] or {})
        name_key = _key(row['name'])
        caliber_key = _key(attributes.get('caliber'))
        changed = False
        if caliber_key == '18x45' and not attributes.get('fixedMagazine'):
            raw_row = attributes.get('raw_row') or {}
            attributes['fixedMagazine'] = True
            attributes['magazine_size'] = int(float(str(raw_row.get('C') or 1).replace(',', '.')))
            changed = True
        cycle_type = None
        if any(name_key.endswith(value) if len(value) <= 2 else value in name_key for value in bolt_names):
            cycle_type = 'bolt'
        elif any(name_key.endswith(value) if len(value) <= 2 else value in name_key for value in pump_names):
            cycle_type = 'pump'
        if cycle_type and attributes.get('manual_cycle') != cycle_type:
            attributes['manual_cycle'] = cycle_type
            changed = True
        if changed:
            bind.execute(
                templates.update()
                .where(templates.c.id == row['id'])
                .values(attributes=attributes)
            )


def downgrade():
    pass
