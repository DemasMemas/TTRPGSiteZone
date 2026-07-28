"""make clips regular magazines

Revision ID: e7b42c8d1f90
Revises: d6da02b4c789
Create Date: 2026-07-28 18:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'e7b42c8d1f90'
down_revision = 'd6da02b4c789'
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
        if 'клипс' not in str(row['name'] or '').lower():
            continue
        attributes = dict(row['attributes'] or {})
        attributes['isLoader'] = False
        bind.execute(
            templates.update()
            .where(templates.c.id == row['id'])
            .values(attributes=attributes)
        )


def downgrade():
    pass
