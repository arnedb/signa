"""Import the old ``vgt`` app: ``lexicon.db`` (guid, word, year, list_number, video_file) + MP4s."""

import json
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from vgt import media
from vgt.models import Clip, ClipSource, Word, WordStatus
from vgt.services import words as word_service


@dataclass
class LegacyRow:
    guid: str
    word: str
    year: int
    list_number: str | None
    video_file: str | None


@dataclass
class Report:
    words_created: int = 0
    clips_created: int = 0
    skipped: list[dict] = field(default_factory=list)
    problems: list[dict] = field(default_factory=list)

    def to_markdown(self) -> str:
        lines = [
            "# Legacy import report",
            "",
            f"- Words created: {self.words_created}",
            f"- Clips created: {self.clips_created}",
            f"- Skipped rows: {len(self.skipped)}",
            f"- Problems: {len(self.problems)}",
            "",
        ]
        if self.problems:
            lines += ["## Problems", "", "| guid | word | problem |", "|---|---|---|"]
            lines += [f"| {p['guid']} | {p['word']} | {p['problem']} |" for p in self.problems]
            lines.append("")
        if self.skipped:
            lines += ["## Skipped", "", "| guid | word | reason |", "|---|---|---|"]
            lines += [f"| {p['guid']} | {p['word']} | {p['reason']} |" for p in self.skipped]
        return "\n".join(lines) + "\n"


def lesson_of(list_number: str | None) -> int | None:
    """Lists are numbered '<lesson>.<part>', so list '3.2' belongs to lesson 3."""
    if not list_number:
        return None
    head = list_number.split(".")[0].strip()
    return int(head) if head.isdigit() else None


def read_rows(db_path: Path) -> list[LegacyRow]:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    table = next(
        (
            r[0]
            for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")
            if {"guid", "word", "year", "list_number", "video_file"}
            <= {c[1] for c in con.execute(f"PRAGMA table_info('{r[0]}')")}
        ),
        None,
    )
    if table is None:
        raise SystemExit("No table with guid, word, year, list_number, video_file found")
    rows = [
        LegacyRow(
            guid=str(r["guid"]),
            word=(r["word"] or "").strip(),
            year=int(r["year"] or 1),
            list_number=(str(r["list_number"]).strip() or None)
            if r["list_number"] is not None
            else None,
            video_file=(r["video_file"] or "").strip() or None,
        )
        for r in con.execute(f"SELECT * FROM '{table}' ORDER BY rowid")
    ]
    con.close()
    return rows


def import_legacy(
    db: Session,
    lexicon: Path,
    video_dir: Path,
    *,
    dry_run: bool = False,
    workers: int | None = None,
    status: WordStatus = WordStatus.published,
) -> Report:
    report = Report()
    rows = read_rows(lexicon)
    done_guids = set(db.scalars(select(Word.legacy_id).where(Word.legacy_id.is_not(None))))

    todo: list[tuple[LegacyRow, Path]] = []
    for row in rows:
        if not row.word:
            report.skipped.append({"guid": row.guid, "word": "", "reason": "empty word"})
        elif row.guid in done_guids:
            report.skipped.append(
                {"guid": row.guid, "word": row.word, "reason": "already imported"}
            )
        elif not row.video_file:
            report.problems.append({"guid": row.guid, "word": row.word, "problem": "no video_file"})
            todo.append((row, Path()))
        elif not (video_dir / row.video_file).is_file():
            report.problems.append(
                {"guid": row.guid, "word": row.word, "problem": f"missing file {row.video_file}"}
            )
            todo.append((row, Path()))
        else:
            todo.append((row, video_dir / row.video_file))

    if dry_run:
        return report

    def encode(item: tuple[LegacyRow, Path]) -> media.ClipFiles | str | None:
        _row, path = item
        if not path.name:
            return None
        try:
            return media.make_clip(path)
        except media.MediaError as exc:
            return str(exc)

    with ThreadPoolExecutor(max_workers=workers or max(1, (os.cpu_count() or 2) - 1)) as pool:
        encoded = list(pool.map(encode, todo))

    by_key: dict[tuple[str, int, str | None], Word] = {
        (w.gloss.lower(), w.year, w.list_number): w for w in db.scalars(select(Word))
    }
    positions: dict[tuple[int, str | None], int] = {}
    for (row, _path), files in zip(todo, encoded, strict=True):
        key = (row.word.lower(), row.year, row.list_number)
        word = by_key.get(key)
        if word is None:
            pos = positions.get((row.year, row.list_number), 0) + 1
            positions[(row.year, row.list_number)] = pos
            word = Word(
                gloss=row.word,
                year=row.year,
                lesson=lesson_of(row.list_number),
                list_number=row.list_number,
                position=pos,
                status=status,
                legacy_id=row.guid,
            )
            db.add(word)
            db.flush()
            word_service.log(db, word, None, "import", {"legacy_id": row.guid})
            by_key[key] = word
            report.words_created += 1
        else:
            positions[(row.year, row.list_number)] = max(
                positions.get((row.year, row.list_number), 0), word.position
            )
        if isinstance(files, str):
            report.problems.append({"guid": row.guid, "word": row.word, "problem": files})
        elif files is not None:
            clip = Clip(
                file=files.file,
                thumb=files.thumb,
                duration=files.duration,
                source=ClipSource.legacy,
            )
            word_service.attach_clip(db, word, clip, "extra", None)
            report.clips_created += 1
    db.commit()
    return report


def write_report(report: Report, path: Path) -> None:
    path.write_text(report.to_markdown())
    path.with_suffix(".json").write_text(json.dumps(report.__dict__, indent=2))
