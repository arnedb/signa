import shutil
import sqlite3
from pathlib import Path

from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session

from vgt import db as vgt_db
from vgt.config import get_settings
from vgt.db import Base
from vgt.legacy import import_legacy, lesson_of
from vgt.models import Word


def _lexicon(tmp_path: Path, sample: Path) -> tuple[Path, Path]:
    videos = tmp_path / "old"
    videos.mkdir()
    shutil.copy(sample, videos / "a.mp4")
    shutil.copy(sample, videos / "b.mp4")
    path = tmp_path / "lexicon.db"
    con = sqlite3.connect(path)
    con.execute(
        "CREATE TABLE lexicon (guid TEXT, word TEXT, year INT, list_number TEXT, video_file TEXT)"
    )
    con.executemany(
        "INSERT INTO lexicon VALUES (?,?,?,?,?)",
        [
            ("g1", "huis", 1, "1.1", "a.mp4"),
            ("g2", "huis", 1, "1.1", "b.mp4"),  # same word: second clip
            ("g3", "huis", 2, "1.1", "a.mp4"),  # year 2 reuses list numbers
            ("g4", "kat", 1, "1.2", "missing.mp4"),
            ("g5", "", 1, "1.2", "a.mp4"),
        ],
    )
    con.commit()
    con.close()
    return path, videos


def test_import_legacy(db: Session, tmp_path: Path, sample_video: Path) -> None:
    lexicon, videos = _lexicon(tmp_path, sample_video)
    dry = import_legacy(db, lexicon, videos, dry_run=True)
    assert dry.words_created == 0 and len(dry.problems) == 1

    report = import_legacy(db, lexicon, videos, workers=2)
    assert report.words_created == 3
    assert report.clips_created == 3
    assert [p["guid"] for p in report.problems] == ["g4"]
    assert [s["guid"] for s in report.skipped] == ["g5"]
    words = db.scalars(select(Word).order_by(Word.id)).all()
    assert [(w.gloss, w.year, w.list_number, w.lesson, len(w.clips)) for w in words] == [
        ("huis", 1, "1.1", 1, 2),
        ("huis", 2, "1.1", 1, 1),
        ("kat", 1, "1.2", 1, 0),
    ]
    assert words[0].legacy_id == "g1"
    assert "| g4 | kat |" in report.to_markdown()

    again = import_legacy(db, lexicon, videos)
    assert again.words_created == 0


def test_lesson_of() -> None:
    assert lesson_of("3.2") == 3
    assert lesson_of(None) is None
    assert lesson_of("x") is None


def test_migrations_match_models(tmp_path: Path, monkeypatch) -> None:
    from vgt.cli import migrate

    url = f"sqlite:///{tmp_path}/migrated.db"
    monkeypatch.setenv("VGT_DATABASE_URL", url)
    get_settings.cache_clear()
    vgt_db.set_engine(vgt_db.make_engine(url))
    migrate()
    engine = create_engine(url)
    tables = set(inspect(engine).get_table_names()) - {"alembic_version"}
    assert tables == set(Base.metadata.tables)
    for name, table in Base.metadata.tables.items():
        cols = {c["name"] for c in inspect(engine).get_columns(name)}
        assert cols == set(table.columns.keys()), name


def test_demo_seed(db: Session) -> None:
    from vgt.demo import DEMO_WORDS, seed_demo

    counts = seed_demo(db)
    assert counts["words"] == sum(len(v) for v in DEMO_WORDS.values())
    assert counts["users"] == 3
    assert seed_demo(db)["words"] == 0
