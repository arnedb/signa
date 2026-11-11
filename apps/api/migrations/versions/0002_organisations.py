"""organisations: schools with their own words, groups and members

Existing data moves into one organisation, "School" (short name ``school``, language VGT).
A superadmin can rename it. Old admins become superadmins and admins of that school;
everyone else keeps their role there.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-11 10:09:57.097639
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# A copy of vgt.languages.DEFAULT_LANGUAGES as it was when this migration was written.
LANGUAGES = {
    "vgt": "Vlaamse Gebarentaal",
    "lsfb": "Langue des signes de Belgique francophone",
    "ngt": "Nederlandse Gebarentaal",
}

ROLE = sa.Enum("student", "teacher", "admin", name="role", native_enum=False, length=16)

# (table, column nullable at the end, index name)
ORG_COLUMNS = [
    ("groups", False, "ix_groups_org_id"),
    ("group_events", False, "ix_group_events_org_id"),
    ("jobs", True, "ix_jobs_org_id"),
    ("words", False, None),
]


def upgrade() -> None:
    languages = op.create_table(
        "languages",
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.PrimaryKeyConstraint("code"),
    )
    op.bulk_insert(languages, [{"code": c, "name": n} for c, n in LANGUAGES.items()])

    op.create_table(
        "organisations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("language_code", sa.String(length=16), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["language_code"], ["languages.code"], name="fk_organisations_language_code"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("organisations", schema=None) as batch_op:
        batch_op.create_index("ix_organisations_slug", ["slug"], unique=True)

    op.create_table(
        "org_members",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("role", ROLE, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organisations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "org_id"),
    )
    with op.batch_alter_table("org_members", schema=None) as batch_op:
        batch_op.create_index("ix_org_members_org_id", ["org_id"], unique=False)

    # --- move existing data into one organisation ---------------------------------------
    conn = op.get_bind()
    has_data = any(
        conn.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first()
        for table in ("users", "groups", "words", "jobs")
    )
    if has_data:
        conn.execute(
            sa.text(
                "INSERT INTO organisations (id, name, slug, language_code, active, created_at) "
                "VALUES (1, 'School', 'school', 'vgt', 1, CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO org_members (user_id, org_id, role, created_at) "
                "SELECT id, 1, role, created_at FROM users"
            )
        )

    for table, nullable, index in ORG_COLUMNS:
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.add_column(sa.Column("org_id", sa.Integer(), nullable=True))
        if has_data:
            conn.execute(sa.text(f"UPDATE {table} SET org_id = 1"))
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.alter_column("org_id", existing_type=sa.Integer(), nullable=nullable)
            if index:
                batch_op.create_index(index, ["org_id"], unique=False)
            batch_op.create_foreign_key(
                f"fk_{table}_org_id", "organisations", ["org_id"], ["id"], ondelete="CASCADE"
            )

    with op.batch_alter_table("words", schema=None) as batch_op:
        batch_op.drop_index("ix_words_year_list")
        batch_op.create_index("ix_words_org_year_list", ["org_id", "year", "list_number"])

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_superadmin", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.add_column(sa.Column("current_org_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("current_group_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_users_current_org_id",
            "organisations",
            ["current_org_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_users_current_group_id",
            "groups",
            ["current_group_id"],
            ["id"],
            ondelete="SET NULL",
        )
    conn.execute(sa.text("UPDATE users SET is_superadmin = 1 WHERE role = 'admin'"))
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("role")


def downgrade() -> None:
    conn = op.get_bind()
    orgs = conn.execute(sa.text("SELECT count(*) FROM organisations")).scalar() or 0
    if orgs > 1:
        raise RuntimeError("Cannot downgrade: there is more than one organisation")

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("role", ROLE, nullable=False, server_default="student"))
    conn.execute(
        sa.text(
            "UPDATE users SET role = COALESCE("
            "(SELECT role FROM org_members WHERE org_members.user_id = users.id), 'student')"
        )
    )
    conn.execute(sa.text("UPDATE users SET role = 'admin' WHERE is_superadmin = 1"))
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_constraint("fk_users_current_group_id", type_="foreignkey")
        batch_op.drop_constraint("fk_users_current_org_id", type_="foreignkey")
        batch_op.drop_column("current_group_id")
        batch_op.drop_column("current_org_id")
        batch_op.drop_column("is_superadmin")

    with op.batch_alter_table("words", schema=None) as batch_op:
        batch_op.drop_index("ix_words_org_year_list")
        batch_op.create_index("ix_words_year_list", ["year", "list_number"])

    for table, _nullable, index in reversed(ORG_COLUMNS):
        with op.batch_alter_table(table, schema=None) as batch_op:
            batch_op.drop_constraint(f"fk_{table}_org_id", type_="foreignkey")
            if index:
                batch_op.drop_index(index)
            batch_op.drop_column("org_id")

    op.drop_table("org_members")
    op.drop_table("organisations")
    op.drop_table("languages")
