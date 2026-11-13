"""last used school: ``org_members.last_used_at``

When the user's current school is no longer available, the school they used most recently
is chosen. The current school of each user counts as used now.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-13 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("org_members", schema=None) as batch_op:
        batch_op.add_column(sa.Column("last_used_at", sa.DateTime(), nullable=True))
    op.execute(
        "UPDATE org_members SET last_used_at = CURRENT_TIMESTAMP WHERE EXISTS ("
        "SELECT 1 FROM users WHERE users.id = org_members.user_id "
        "AND users.current_org_id = org_members.org_id)"
    )


def downgrade() -> None:
    with op.batch_alter_table("org_members", schema=None) as batch_op:
        batch_op.drop_column("last_used_at")
