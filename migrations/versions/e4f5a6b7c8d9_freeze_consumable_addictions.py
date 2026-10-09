"""Freeze legacy consumable addiction rules before templates are renamed."""

from alembic import op
import sqlalchemy as sa

from app.services.addictions import addiction_profile


revision = 'e4f5a6b7c8d9'
down_revision = 'e3f4a5b6c7d8'
branch_labels = None
depends_on = None


def upgrade():
    templates = sa.table(
        'item_templates',
        sa.column('id', sa.Integer),
        sa.column('name', sa.String),
        sa.column('category', sa.String),
        sa.column('price', sa.Integer),
        sa.column('attributes', sa.JSON),
    )
    connection = op.get_bind()
    rows = connection.execute(
        sa.select(templates).where(templates.c.category.in_(('consumable', 'gas_mask_module')))
    ).mappings().all()
    for row in rows:
        attributes = row['attributes'] or {}
        profile = attributes.get('consumable')
        if not isinstance(profile, dict) or not isinstance(profile.get('direct'), dict):
            continue
        catalog_name = attributes.get('catalog_name') or row['name']
        changed = False
        if 'catalog_name' not in attributes:
            attributes['catalog_name'] = catalog_name
            changed = True
        if 'addiction' not in profile:
            profile['addiction'] = addiction_profile(catalog_name, row['price'])
            changed = True
        if changed:
            connection.execute(
                sa.update(templates).where(templates.c.id == row['id']).values(attributes=attributes)
            )


def downgrade():
    # Frozen rules may have been edited after migration; removing them would lose data.
    pass
