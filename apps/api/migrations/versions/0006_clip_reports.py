"""clip reports: ``clip_reports``

Students and teachers report a problem with a clip (wrong sign, start or end cut badly…)
with a comment. Teachers see the open reports and mark them as resolved.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-13 15:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "clip_reports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("word_id", sa.Integer(), nullable=False),
        sa.Column("clip_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column(
            "reason",
            sa.Enum(
                "wrong_sign",
                "cut_start",
                "cut_end",
                "quality",
                "other",
                name="reportreason",
                native_enum=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organisations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["word_id"], ["words.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["clip_id"], ["clips.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_clip_reports_org_resolved", "clip_reports", ["org_id", "resolved_at"])
    op.create_index("ix_clip_reports_word_id", "clip_reports", ["word_id"])


def downgrade() -> None:
    op.drop_index("ix_clip_reports_word_id", table_name="clip_reports")
    op.drop_index("ix_clip_reports_org_resolved", table_name="clip_reports")
    op.drop_table("clip_reports")
