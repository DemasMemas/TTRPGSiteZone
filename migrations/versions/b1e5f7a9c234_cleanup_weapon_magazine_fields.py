"""cleanup weapon magazine fields

Revision ID: b1e5f7a9c234
Revises: a0d4e6f8b123
Create Date: 2026-07-28 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b1e5f7a9c234'
down_revision = 'a0d4e6f8b123'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        'item_templates',
        sa.column('id', sa.Integer),
        sa.column('category', sa.String),
        sa.column('attributes', sa.JSON),
    )
    characters = sa.table(
        'lobby_characters',
        sa.column('id', sa.Integer),
        sa.column('data', sa.JSON),
    )

    template_rows = bind.execute(
        sa.select(templates.c.id, templates.c.attributes).where(
            templates.c.category == 'weapon',
        )
    ).mappings()
    for row in template_rows:
        attributes = dict(row['attributes'] or {})
        changed = False
        for key in ('magazine', 'magazine_size_raw'):
            if key in attributes:
                attributes.pop(key)
                changed = True
        is_fixed = bool(attributes.get('fixedMagazine') or attributes.get('fixed_magazine'))
        if not is_fixed and 'magazine_size' in attributes:
            attributes.pop('magazine_size')
            changed = True
        if changed:
            bind.execute(
                templates.update()
                .where(templates.c.id == row['id'])
                .values(attributes=attributes)
            )

    character_rows = bind.execute(
        sa.select(characters.c.id, characters.c.data)
    ).mappings()
    for row in character_rows:
        data = dict(row['data'] or {})
        weapons = data.get('weapons')
        if not isinstance(weapons, list):
            continue
        changed = False
        cleaned_weapons = []
        for weapon in weapons:
            if not isinstance(weapon, dict):
                cleaned_weapons.append(weapon)
                continue
            cleaned_weapon = dict(weapon)
            for key in ('magazine', 'magazine_size'):
                if key in cleaned_weapon:
                    cleaned_weapon.pop(key)
                    changed = True
            cleaned_weapons.append(cleaned_weapon)
        if changed:
            data['weapons'] = cleaned_weapons
            bind.execute(
                characters.update()
                .where(characters.c.id == row['id'])
                .values(data=data)
            )


def downgrade():
    pass
