"""fix short manual cycle weapon names

Revision ID: d6da02b4c789
Revises: d5c9f1a3b678
Create Date: 2026-07-28 15:30:00.000000

"""
import re

from alembic import op
import sqlalchemy as sa


revision = 'd6da02b4c789'
down_revision = 'd5c9f1a3b678'
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
        'Суслик', 'Малинова', 'Мачеха 51', 'Свет-99', 'Пылесос',
    )}
    pump_names = {_key(value) for value in (
        'Гора Б88', 'Гора 580Б2', 'Ремень 787', 'Спаситель 70',
    )}
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.name, templates.c.attributes)
        .where(templates.c.category == 'weapon')
    ).mappings()
    for row in rows:
        name = str(row['name'] or '')
        name_key = _key(name)
        lowered = name.lower()
        cycle_type = None
        if any(value in name_key for value in bolt_names) or re.search(r'(?:^|\s)ау(?:\s|$)', lowered):
            cycle_type = 'bolt'
        elif any(value in name_key for value in pump_names) or re.search(r'(?:^|\s)д-?2(?:\s|$)', lowered):
            cycle_type = 'pump'
        attributes = dict(row['attributes'] or {})
        if cycle_type:
            attributes['manual_cycle'] = cycle_type
        else:
            attributes.pop('manual_cycle', None)
        bind.execute(
            templates.update()
            .where(templates.c.id == row['id'])
            .values(attributes=attributes)
        )


def downgrade():
    pass
