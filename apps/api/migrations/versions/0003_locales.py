"""locales: interface language per user and per sign language; weekdays as codes

- ``languages.locale``: the spoken language of the glosses (vgt, ngt: nl; lsfb: fr).
- ``users.locale``: the interface language the user chose, or NULL to follow the school.
- ``groups.weekday`` holds a code (mon … sun) instead of a Dutch name. Group names stay as
  they are.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-11 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DUTCH = ("maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag")
CODES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
# A copy of the locales in signa.languages.DEFAULT_LANGUAGES as they were for this migration.
LOCALES = {"vgt": "nl", "lsfb": "fr", "ngt": "nl"}


def _weekdays(src: tuple[str, ...], dst: tuple[str, ...]) -> None:
    conn = op.get_bind()
    for a, b in zip(src, dst, strict=True):
        conn.execute(sa.text("UPDATE groups SET weekday = :b WHERE weekday = :a"), {"a": a, "b": b})


def upgrade() -> None:
    with op.batch_alter_table("languages", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("locale", sa.String(length=8), nullable=False, server_default="nl")
        )
    conn = op.get_bind()
    for code, locale in LOCALES.items():
        conn.execute(
            sa.text("UPDATE languages SET locale = :l WHERE code = :c"), {"l": locale, "c": code}
        )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("locale", sa.String(length=8), nullable=True))
    _weekdays(DUTCH, CODES)


def downgrade() -> None:
    _weekdays(CODES, DUTCH)
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("locale")
    with op.batch_alter_table("languages", schema=None) as batch_op:
        batch_op.drop_column("locale")
