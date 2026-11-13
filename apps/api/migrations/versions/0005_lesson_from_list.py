"""fill in missing lessons from the list number

Every word now has its own lesson. Words without one get it from their list number where
that follows the "<lesson>.<part>" pattern ("3.2" is lesson 3); the others stay empty.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-13 14:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

words = sa.table(
    "words",
    sa.column("id", sa.Integer),
    sa.column("lesson", sa.Integer),
    sa.column("list_number", sa.String),
)


def lesson_of(list_number: str) -> int | None:
    # A copy, not an import: a migration must keep working when the app code changes.
    head = list_number.split(".")[0].strip()
    return int(head) if head.isdigit() else None


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(words.c.id, words.c.list_number).where(
            words.c.lesson.is_(None), words.c.list_number.is_not(None)
        )
    ).all()
    for word_id, list_number in rows:
        lesson = lesson_of(list_number)
        if lesson is not None:
            bind.execute(words.update().where(words.c.id == word_id).values(lesson=lesson))


def downgrade() -> None:
    # The filled-in lessons are valid data; there is nothing to undo.
    pass
