"""Consistent SQLite backups, safe while the app is running (sqlite3 backup API)."""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from vgt.config import get_settings


def database_path() -> Path:
    url = get_settings().database_url
    if not url.startswith("sqlite:///"):
        raise SystemExit("Backups support SQLite databases only")
    return Path(url.removeprefix("sqlite:///"))


def backup(label: str = "manual", keep: int | None = None) -> Path | None:
    """Copy the database to ``backup_dir`` and keep the newest ``keep`` copies.

    Returns None when there is no database yet (first deploy).
    """
    s = get_settings()
    src = database_path()
    if not src.is_file():
        return None
    s.backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    dst = s.backup_dir / f"vgt-{stamp}-{label}.db"
    with sqlite3.connect(src) as source, sqlite3.connect(dst) as target:
        source.backup(target)
    copies = sorted(s.backup_dir.glob("vgt-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in copies[keep if keep is not None else s.backup_keep :]:
        old.unlink()
    return dst
