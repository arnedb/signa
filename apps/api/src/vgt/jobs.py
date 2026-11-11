"""A small job queue in the database, worked off by one background thread."""

import logging
import threading
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from vgt import media
from vgt.config import get_settings
from vgt.db import session_factory, utcnow
from vgt.models import Clip, ClipSource, Job, JobKind, JobStatus, User, Word
from vgt.services import words as word_service

log = logging.getLogger("vgt.jobs")
_wake = threading.Event()


def enqueue(db: Session, kind: JobKind, payload: dict[str, Any], user: User | None) -> Job:
    job = Job(kind=kind, payload=payload, created_by=user.id if user else None)
    db.add(job)
    db.commit()
    _wake.set()
    return job


def _run_transcode(db: Session, job: Job) -> dict[str, Any]:
    p = job.payload
    word = db.get(Word, p["word_id"])
    if word is None:
        raise media.MediaError("Word no longer exists")
    files = media.make_clip(media.media_path(p["src"]), p.get("start"), p.get("end"))
    clip = Clip(
        file=files.file,
        thumb=files.thumb,
        duration=files.duration,
        source=ClipSource(p.get("source", "recording")),
        recorded_at=utcnow(),
    )
    user = db.get(User, job.created_by) if job.created_by else None
    word_service.attach_clip(db, word, clip, p.get("mode", "replace"), user)
    if p.get("delete_src"):
        media.media_path(p["src"]).unlink(missing_ok=True)
    return {"clip_id": clip.id, "word_id": word.id}


def _run_split(db: Session, job: Job) -> dict[str, Any]:
    s = get_settings()
    upload = media.media_path(job.payload["upload"])
    # A browser-friendly copy of the whole recording, used to preview and cut.
    source_rel = media.new_rel("sources", ".mp4")
    source = media.media_path(source_rel)
    media.transcode(upload, source)
    upload.unlink(missing_ok=True)
    duration = media.probe_duration(source)
    segments = media.detect_segments(
        source, duration, s.split_noise, s.split_min_freeze, s.split_min_clip
    )
    return {
        "source": source_rel,
        "duration": round(duration, 3),
        "segments": [{"start": a, "end": b} for a, b in segments],
        "applied": [],
    }


def run_job(db: Session, job: Job) -> None:
    job.status = JobStatus.running
    db.commit()
    try:
        result = _run_transcode(db, job) if job.kind == JobKind.transcode else _run_split(db, job)
    except Exception as exc:
        db.rollback()
        log.exception("Job %s failed", job.id)
        job.status = JobStatus.failed
        job.error = str(exc) or exc.__class__.__name__
    else:
        job.status = JobStatus.done
        job.result = result
    db.commit()


def run_pending() -> int:
    """Run all queued jobs. Returns how many ran."""
    count = 0
    factory = session_factory()
    while True:
        with factory() as db:
            job = db.scalars(
                select(Job).where(Job.status == JobStatus.queued).order_by(Job.id).limit(1)
            ).first()
            if job is None:
                return count
            run_job(db, job)
            count += 1


def reset_stale() -> None:
    """Jobs left 'running' by a crash are queued again at startup."""
    with session_factory()() as db:
        for job in db.scalars(select(Job).where(Job.status == JobStatus.running)):
            job.status = JobStatus.queued
        db.commit()


class Worker(threading.Thread):
    def __init__(self) -> None:
        super().__init__(name="vgt-worker", daemon=True)
        self._stop_event = threading.Event()

    def run(self) -> None:
        reset_stale()
        while not self._stop_event.is_set():
            try:
                run_pending()
            except Exception:
                log.exception("Worker loop failed")
            _wake.wait(timeout=5)
            _wake.clear()

    def stop(self) -> None:
        self._stop_event.set()
        _wake.set()
