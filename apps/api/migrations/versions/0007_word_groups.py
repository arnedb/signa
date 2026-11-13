"""word groups: ``word_groups``

A word can be limited to some groups. Words without rows stay for every group, so existing
data does not change.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-13 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "word_groups",
        sa.Column("word_id", sa.Integer(), nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["word_id"], ["words.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("word_id", "group_id"),
    )
    op.create_index("ix_word_groups_group_id", "word_groups", ["group_id"])


def downgrade() -> None:
    op.drop_index("ix_word_groups_group_id", table_name="word_groups")
    op.drop_table("word_groups")
