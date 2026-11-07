"""Command line: ``vgt create-admin``, ``vgt migrate``, ``vgt import-legacy``, ``vgt demo``."""

import argparse
import getpass
import json
import sys
from pathlib import Path

from sqlalchemy import func, select

from vgt.db import session_factory


def migrate() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    command.upgrade(cfg, "head")


def create_admin(username: str, password: str | None) -> None:
    from vgt.models import Role, User
    from vgt.security import hash_secret, new_recovery_code

    if password is None:
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Repeat password: "):
            sys.exit("Passwords do not match")
    if len(password) < 8:
        sys.exit("Use at least 8 characters")
    with session_factory()() as db:
        user = db.scalars(select(User).where(func.lower(User.username) == username.lower())).first()
        code = new_recovery_code()
        if user:
            user.role = Role.admin
            user.password_hash = hash_secret(password)
            print(f"Updated {user.username}: now admin, password changed.")
        else:
            db.add(
                User(
                    username=username,
                    password_hash=hash_secret(password),
                    recovery_hash=hash_secret(code),
                    role=Role.admin,
                )
            )
            print(f"Created admin {username}.\nRecovery code (keep it safe): {code}")
        db.commit()


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="vgt")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("migrate", help="Create or upgrade the database schema")

    p = sub.add_parser("create-admin", help="Create the first admin (or make a user admin)")
    p.add_argument("username")
    p.add_argument("--password", help="Read from a prompt when left out")

    p = sub.add_parser("import-legacy", help="Import lexicon.db and the old MP4 files")
    p.add_argument("lexicon", type=Path)
    p.add_argument("videos", type=Path)
    p.add_argument("--report", type=Path, default=Path("import-report.md"))
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--draft", action="store_true", help="Import words as drafts")
    p.add_argument("--workers", type=int)

    p = sub.add_parser("demo", help="Fill the database with demo words and users")
    p.add_argument("--clips", type=Path, help="Folder with <gloss>.mp4 demo clips")

    sub.add_parser("openapi", help="Print the OpenAPI schema as JSON")

    args = parser.parse_args(argv)
    match args.command:
        case "migrate":
            migrate()
        case "create-admin":
            migrate()
            create_admin(args.username, args.password)
        case "import-legacy":
            from vgt.legacy import import_legacy, write_report
            from vgt.models import WordStatus

            migrate()
            with session_factory()() as db:
                report = import_legacy(
                    db,
                    args.lexicon,
                    args.videos,
                    dry_run=args.dry_run,
                    workers=args.workers,
                    status=WordStatus.draft if args.draft else WordStatus.published,
                )
            write_report(report, args.report)
            print(report.to_markdown().split("\n## ")[0])
            print(f"Report written to {args.report}")
        case "demo":
            from vgt.demo import seed_demo

            migrate()
            with session_factory()() as db:
                counts = seed_demo(db, args.clips)
            print(
                f"Demo data: {counts}. Log in as admin/demo-admin, docent/demo-docent or "
                "student/demo-student. Invite code: demo"
            )
        case "openapi":
            from vgt.main import create_app

            print(json.dumps(create_app(run_worker=False).openapi(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
