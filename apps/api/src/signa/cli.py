"""The `signa` command: serve, migrate, create-admin, create-org, add-language, backup,
import-legacy, demo, openapi."""

import argparse
import getpass
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from signa.db import session_factory

if TYPE_CHECKING:
    from signa.models import Organisation


def migrate() -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    command.upgrade(cfg, "head")


def create_admin(username: str, password: str | None) -> None:
    """Create a superadmin, who manages the schools and acts as admin in each of them."""
    from signa.models import User
    from signa.security import hash_secret, new_recovery_code

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
            user.is_superadmin = True
            user.password_hash = hash_secret(password)
            print(f"Updated {user.username}: now superadmin, password changed.")
        else:
            db.add(
                User(
                    username=username,
                    password_hash=hash_secret(password),
                    recovery_hash=hash_secret(code),
                    is_superadmin=True,
                )
            )
            print(f"Created superadmin {username}.\nRecovery code (keep it safe): {code}")
        db.commit()


def create_org(name: str, language: str, slug: str | None, admin: str | None) -> None:
    from fastapi import HTTPException

    from signa.models import Language, Organisation, Role
    from signa.routers.admin_orgs import slugify
    from signa.services.members import add_member

    slug = slug or slugify(name)
    with session_factory()() as db:
        if db.get(Language, language) is None:
            sys.exit(f"Unknown language '{language}'. Add it first with: signa add-language")
        if db.scalars(select(Organisation).where(Organisation.slug == slug)).first():
            sys.exit(f"An organisation with the short name '{slug}' already exists")
        org = Organisation(name=name, slug=slug, language_code=language)
        db.add(org)
        db.flush()
        print(f"Created organisation {name} ({slug}, {language}).")
        if admin:
            try:
                out = add_member(db, org.id, admin, Role.admin)
            except HTTPException as exc:
                sys.exit(str(exc.detail))
            if out.temporary_password:
                print(f"Created admin {out.username}, temporary password: {out.temporary_password}")
            else:
                print(f"{out.username} is now admin of {name}.")
        db.commit()


def add_language(code: str, name: str, locale: str) -> None:
    from signa.i18n import LOCALES
    from signa.models import Language

    if locale not in LOCALES:
        sys.exit(f"Choose a locale from: {', '.join(LOCALES)}")
    with session_factory()() as db:
        language = db.get(Language, code.lower())
        if language:
            language.name, language.locale = name, locale
        else:
            db.add(Language(code=code.lower(), name=name, locale=locale))
        db.commit()
    print(f"Language {code.lower()}: {name} ({locale})")


def find_org(db: Session, slug: str | None) -> "Organisation":
    """The organisation with this short name, or the only one when there is just one."""
    from signa.models import Organisation

    orgs = db.scalars(select(Organisation)).all()
    if slug:
        org = next((o for o in orgs if o.slug == slug), None)
        if org is None:
            sys.exit(f"No organisation '{slug}'. Known: {', '.join(o.slug for o in orgs) or '-'}")
        return org
    if len(orgs) != 1:
        sys.exit("Choose the organisation with --org <short name>")
    return orgs[0]


def serve(host: str, port: int) -> None:
    import uvicorn

    from signa.config import get_settings

    settings = get_settings()
    migrate()
    if settings.seed_demo:
        if settings.environment == "pro":
            sys.exit("SIGNA_SEED_DEMO is not allowed in the pro environment")
        from signa.demo import seed_demo
        from signa.models import Word

        with session_factory()() as db:
            if db.scalar(select(func.count()).select_from(Word)) == 0:
                print(f"Demo data: {seed_demo(db)}")
    uvicorn.run(
        "signa.main:app",
        host=host,
        port=port,
        proxy_headers=True,
        forwarded_allow_ips="*",
        log_level="info",
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="signa")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("migrate", help="Create or upgrade the database schema")

    p = sub.add_parser(
        "create-admin", help="Create a superadmin, who manages the schools (or make a user one)"
    )
    p.add_argument("username")
    p.add_argument("--password", help="Read from a prompt when left out")

    p = sub.add_parser("create-org", help="Create an organisation (school)")
    p.add_argument("name")
    p.add_argument("--language", default="vgt", help="Language code (default vgt)")
    p.add_argument("--slug", help="Short name, made from the name when left out")
    p.add_argument("--admin", help="First admin: an existing user, or a new account")

    p = sub.add_parser("add-language", help="Add (or rename) a sign language")
    p.add_argument("code", help="Short code, e.g. vgt")
    p.add_argument("name", help="Full name, e.g. 'Vlaamse Gebarentaal'")
    p.add_argument(
        "--locale", default="nl", help="Spoken language of the glosses: nl, fr or en (default nl)"
    )

    p = sub.add_parser("import-legacy", help="Import lexicon.db and the old MP4 files")
    p.add_argument("lexicon", type=Path)
    p.add_argument("videos", type=Path)
    p.add_argument("--report", type=Path, default=Path("import-report.md"))
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--draft", action="store_true", help="Import words as drafts")
    p.add_argument("--workers", type=int)
    p.add_argument("--org", help="Short name of the organisation (needed when there are several)")

    p = sub.add_parser("demo", help="Fill the database with demo words and users")
    p.add_argument("--clips", type=Path, help="Folder with <gloss>.mp4 demo clips")

    sub.add_parser("openapi", help="Print the OpenAPI schema as JSON")

    p = sub.add_parser("serve", help="Migrate, seed demo data if SIGNA_SEED_DEMO, then serve")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)

    p = sub.add_parser("backup", help="Back up the database (safe while running)")
    p.add_argument("--label", default="manual")
    p.add_argument("--keep", type=int, help="Copies to keep (default SIGNA_BACKUP_KEEP)")

    args = parser.parse_args(argv)
    match args.command:
        case "migrate":
            migrate()
        case "create-admin":
            migrate()
            create_admin(args.username, args.password)
        case "create-org":
            migrate()
            create_org(args.name, args.language, args.slug, args.admin)
        case "add-language":
            migrate()
            add_language(args.code, args.name, args.locale)
        case "import-legacy":
            from signa.legacy import import_legacy, write_report
            from signa.models import WordStatus

            migrate()
            with session_factory()() as db:
                report = import_legacy(
                    db,
                    find_org(db, args.org).id,
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
            from signa.demo import seed_demo

            migrate()
            with session_factory()() as db:
                counts = seed_demo(db, args.clips)
            print(
                f"Demo data: {counts}. Log in as admin/demo-admin (superadmin), "
                "docent/demo-docent or student/demo-student. Invite codes: demo, demo-2"
            )
        case "serve":
            serve(args.host, args.port)
        case "backup":
            from signa.backup import backup

            path = backup(args.label, args.keep)
            print(f"Backup written to {path}" if path else "No database yet, nothing to back up.")
        case "openapi":
            from signa.main import create_app

            print(json.dumps(create_app(run_worker=False).openapi(), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
