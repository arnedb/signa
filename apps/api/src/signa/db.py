from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from signa.config import get_settings


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def make_engine(url: str) -> Engine:
    if url.startswith("sqlite:///") and ":memory:" not in url:
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # pyright: ignore[reportUnusedFunction]
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    return engine


_engine: Engine | None = None
_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine, _factory
    if _engine is None:
        _engine = make_engine(get_settings().database_url)
        _factory = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def set_engine(engine: Engine) -> None:
    """Swap the engine (used by tests and the CLI)."""
    global _engine, _factory
    _engine = engine
    _factory = sessionmaker(engine, expire_on_commit=False)


def session_factory() -> sessionmaker[Session]:
    get_engine()
    assert _factory is not None
    return _factory


def get_db() -> Iterator[Session]:
    with session_factory()() as db:
        yield db
