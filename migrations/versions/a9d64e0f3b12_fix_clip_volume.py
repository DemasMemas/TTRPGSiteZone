"""fix clip volume

Revision ID: a9d64e0f3b12
Revises: f8c53d9e2a01
Create Date: 2026-07-28 18:45:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'a9d64e0f3b12'
down_revision = 'f8c53d9e2a01'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    templates = sa.table(
        'item_templates',
        sa.column('id', sa.Integer),
        sa.column('name', sa.String),
        sa.column('category', sa.String),
        sa.column('volume', sa.Float),
    )
    rows = bind.execute(
        sa.select(templates.c.id, templates.c.name)
        .where(templates.c.category == 'magazine')
    ).mappings()
    for row in rows:
        if 'клипс' in str(row['name'] or '').lower():
            bind.execute(
                templates.update()
                .where(templates.c.id == row['id'])
                .values(volume=0.25)
            )


def downgrade():
    pass
