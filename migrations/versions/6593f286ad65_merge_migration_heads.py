"""merge migration heads

Revision ID: 6593f286ad65
Revises: 749bf62128de, 7bd3a9c4f2e1
Create Date: 2026-07-24 18:58:54.778856

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6593f286ad65'
down_revision = ('749bf62128de', '7bd3a9c4f2e1')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
