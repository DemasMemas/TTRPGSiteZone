"""fix ammo loading data

Revision ID: f8c53d9e2a01
Revises: e7b42c8d1f90
Create Date: 2026-07-28 18:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'f8c53d9e2a01'
down_revision = 'e7b42c8d1f90'
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
        sa.column('item_class', sa.String),
        sa.column('description', sa.Text),
        sa.column('price', sa.Integer),
        sa.column('weight', sa.Float),
        sa.column('volume', sa.Float),
        sa.column('attributes', sa.JSON),
        sa.column('compatible_ids', sa.JSON),
    )

    magazine_rows = bind.execute(
        sa.select(
            templates.c.id,
            templates.c.name,
            templates.c.subcategory,
            templates.c.attributes,
        ).where(templates.c.category == 'magazine')
    ).mappings()
    has_loader = False
    for row in magazine_rows:
        name = str(row['name'] or '')
        lowered = name.lower()
        attributes = dict(row['attributes'] or {})
        values = {}
        if 'клипс' in lowered:
            values['volume'] = 1.0
        if 'подавач' in lowered:
            has_loader = True
        caliber = str(attributes.get('caliber') or row['subcategory'] or '')
        if 'аср' in caliber.lower():
            canonical = '.45 ACP'
            attributes['caliber'] = canonical
            values['subcategory'] = canonical
            values['attributes'] = attributes
        if values:
            bind.execute(
                templates.update()
                .where(templates.c.id == row['id'])
                .values(**values)
            )

    if not has_loader:
        bind.execute(
            templates.insert().values(
                name='Подавач',
                category='magazine',
                subcategory=None,
                item_class='Инструмент зарядки',
                description='Универсальный подавач на 20 патронов.',
                price=0,
                weight=0.0,
                volume=1.0,
                attributes={
                    'capacity': 20,
                    'caliber': None,
                    'isLoader': True,
                    'universalLoader': True,
                },
                compatible_ids=[],
            )
        )


def downgrade():
    pass
