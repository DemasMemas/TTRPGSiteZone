"""Record completed consumable uses to reject duplicate application."""
from alembic import op
import sqlalchemy as sa

revision = 'd1e2f3a4b5c6'
down_revision = 'c0d1e2f3a4b5'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'consumable_uses',
        sa.Column('id', sa.String(120), primary_key=True),
        sa.Column('actor_character_id', sa.Integer(), sa.ForeignKey('lobby_characters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('target_character_id', sa.Integer(), sa.ForeignKey('lobby_characters.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )


def downgrade():
    op.drop_table('consumable_uses')
